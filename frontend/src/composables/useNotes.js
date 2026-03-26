import { ref } from 'vue'
import { getCached } from '@/api/http'

export function useNotes() {
  const notes = ref([])
  const availableTags = ref([])
  const loading = ref(true)
  const error = ref(null)
  
  const pageSize = 500
  const currentPage = ref(0)
  const hasMore = ref(true)
  const isLoadingMore = ref(false)
  
  const apiUrl = import.meta.env.VITE_API_URL || ''

  const fetchTags = async () => {
    try {
      const data = await getCached(`${apiUrl}/api/tags`, {
        useCache: true,
        cacheTtl: 600
      })
      availableTags.value = data
    } catch (err) {
      console.error('Error fetching tags:', err.message)
    }
  }

  const loadMoreNotes = async (searchQuery = '') => {
    if (isLoadingMore.value || !hasMore.value) return
    
    isLoadingMore.value = true
    try {
      const offset = currentPage.value * pageSize
      const data = await getCached(`${apiUrl}/api/notes`, {
        useCache: !searchQuery,
        cacheTtl: 300,
        params: {
          limit: pageSize,
          offset: offset,
          search: searchQuery || undefined
        }
      })
      
      if (currentPage.value === 0) {
        notes.value = data
      } else {
        notes.value.push(...data)
      }
      
      hasMore.value = data.length === pageSize
      currentPage.value++
    } catch (err) {
      console.error('Error loading notes:', err)
      error.value = err.message
    } finally {
      isLoadingMore.value = false
    }
  }

  const fetchNotes = async (searchQuery = '') => {
    try {
      loading.value = true
      currentPage.value = 0
      notes.value = []
      hasMore.value = true
      await loadMoreNotes(searchQuery)
    } catch (err) {
      error.value = err.message
    } finally {
      loading.value = false
    }
  }

  const resetPagination = (searchQuery = '') => {
    currentPage.value = 0
    notes.value = []
    hasMore.value = true
    loadMoreNotes(searchQuery)
  }

  return {
    notes,
    availableTags,
    loading,
    error,
    hasMore,
    isLoadingMore,
    fetchNotes,
    loadMoreNotes,
    fetchTags,
    resetPagination
  }
}
