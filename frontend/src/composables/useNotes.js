import { readonly, ref } from 'vue'
import { getCached, invalidateCached } from '@/api/http'
import { apiUrl } from '@/config/env'
import { invalidateGraph } from './useGraphData'
import { listenToSync } from './syncSocket'

// Bumped whenever a note is saved or created in the app, so every list of
// notes (the sidebar's tree, the tags, the graph) fetches again instead of
// showing what it had before the change.
const notesVersion = ref(0)

/** Call after a note was saved: drops the cached lists and tells their views. */
export function notifyNotesChanged() {
  invalidateCached(`${apiUrl}/api/notes`)
  invalidateCached(`${apiUrl}/api/tags`)
  invalidateCached(`${apiUrl}/api/container-folders`)
  invalidateGraph()
  notesVersion.value++
}

/** A number that changes each time notifyNotesChanged() is called. */
export function useNotesChanged() {
  return readonly(notesVersion)
}

/** Listens for the server noticing the vault change on disk (a pull, Obsidian,
 * a note saved by someone else) and refreshes the lists as a save here would.
 * Changes missed while the socket was down count too: a reconnection
 * refreshes, the first connection doesn't. Returns the function that stops. */
export function listenForVaultChanges() {
  let connected = false
  return listenToSync({
    onEvent: (event) => {
      if (event.type === 'notes') notifyNotesChanged()
    },
    onOpen: () => {
      if (connected) notifyNotesChanged()
      connected = true
    }
  })
}

export function useNotes() {
  const notes = ref([])
  const availableTags = ref([])
  const loading = ref(true)
  const error = ref(null)

  const pageSize = 500
  const currentPage = ref(0)
  const hasMore = ref(true)
  const isLoadingMore = ref(false)

  // Each (re)load of the list takes a new token; a page that comes back for
  // an older one is dropped instead of being mixed into the new list.
  let token = 0

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

  const loadPage = async (searchQuery, requestToken) => {
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
      if (requestToken !== token) return

      const safeData = Array.isArray(data) ? data : []
      if (currentPage.value === 0) {
        notes.value = safeData
      } else {
        notes.value = [...notes.value, ...safeData]
      }

      hasMore.value = safeData.length === pageSize
      currentPage.value++
    } catch (err) {
      if (requestToken !== token) return
      console.error('Error loading notes:', err)
      error.value = err.message
    } finally {
      if (requestToken === token) isLoadingMore.value = false
    }
  }

  const loadMoreNotes = async (searchQuery = '') => {
    if (isLoadingMore.value || !hasMore.value) return
    await loadPage(searchQuery, token)
  }

  // Starts the list over. `keep` leaves the current list on screen until the
  // first page replaces it (a refresh after a save), instead of emptying it.
  const reload = async (searchQuery, { keep }) => {
    const requestToken = ++token
    loading.value = true
    error.value = null
    currentPage.value = 0
    hasMore.value = true
    if (!keep) notes.value = []
    await loadPage(searchQuery, requestToken)
    if (requestToken === token) loading.value = false
  }

  const fetchNotes = (searchQuery = '') => reload(searchQuery, { keep: false })
  const refreshNotes = (searchQuery = '') => reload(searchQuery, { keep: true })

  const resetPagination = (searchQuery = '') => {
    fetchNotes(searchQuery)
  }

  return {
    notes,
    availableTags,
    loading,
    error,
    hasMore,
    isLoadingMore,
    fetchNotes,
    refreshNotes,
    loadMoreNotes,
    fetchTags,
    resetPagination
  }
}
