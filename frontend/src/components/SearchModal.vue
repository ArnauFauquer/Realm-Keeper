<template>
  <div v-if="isOpen" class="modal-overlay" @click.self="closeModal">
    <div class="modal-content">
      <div class="modal-header">
        <h2>Search Notes</h2>
        <button class="close-btn" @click="closeModal">
          <span class="mdi mdi-close"></span>
        </button>
      </div>

      <div class="modal-body">
        <div class="search-section">
          <input 
            v-model="searchQuery"
            type="text" 
            placeholder="Search notes..." 
            class="search-input"
          />
        </div>

        <div class="tag-filter-section">
          <button 
            class="tag-filter-toggle"
            :class="{ 'is-active': showTagFilter }"
            @click="showTagFilter = !showTagFilter"
          >
            <span class="mdi mdi-tag-multiple"></span>
            <span>Tags</span>
            <span v-if="selectedTags.length" class="tag-count">{{ selectedTags.length }}</span>
            <span class="mdi" :class="showTagFilter ? 'mdi-chevron-up' : 'mdi-chevron-down'"></span>
          </button>
          
          <div v-if="showTagFilter" class="tag-filter-dropdown">
            <input 
              v-model="tagSearchQuery"
              type="text"
              placeholder="Search tags..."
              class="tag-search-input"
            />
            <div class="tag-list">
              <button
                v-for="tag in filteredAvailableTags"
                :key="tag"
                class="tag-item"
                :class="{ 'is-selected': selectedTags.includes(tag) }"
                @click="toggleTag(tag)"
              >
                <span class="mdi" :class="selectedTags.includes(tag) ? 'mdi-checkbox-marked' : 'mdi-checkbox-blank-outline'"></span>
                {{ tag }}
              </button>
              <div v-if="filteredAvailableTags.length === 0" class="no-tags">
                No tags found
              </div>
            </div>
            <button 
              v-if="selectedTags.length > 0"
              class="clear-tags-btn"
              @click="clearTags"
            >
              <span class="mdi mdi-close-circle"></span>
              Clear filters
            </button>
          </div>
        </div>

        <!-- Selected Tags Display -->
        <div v-if="selectedTags.length > 0" class="selected-tags">
          <span 
            v-for="tag in selectedTags" 
            :key="tag" 
            class="selected-tag"
            @click="removeTag(tag)"
          >
            {{ tag }}
            <span class="mdi mdi-close"></span>
          </span>
        </div>

        <div class="results-section">
          <div v-if="filteredNotes.length === 0" class="no-results">
            No notes found matching your criteria.
          </div>
          <div v-else class="results-list">
            <router-link 
              v-for="note in filteredNotes" 
              :key="note.id"
              :to="'/note/' + encodeURIComponent(note.id)"
              class="result-item"
              @click="closeModal"
            >
              <span class="mdi mdi-file-document-outline"></span>
              <div class="result-info">
                <span class="result-title">{{ note.title || note.id.split('/').pop() }}</span>
                <span class="result-path">{{ note.id }}</span>
              </div>
            </router-link>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  isOpen: {
    type: Boolean,
    required: true
  },
  notes: {
    type: Array,
    required: true
  },
  availableTags: {
    type: Array,
    required: true
  }
})

const emit = defineEmits(['close'])

const searchQuery = ref('')
const selectedTags = ref([])
const showTagFilter = ref(false)
const tagSearchQuery = ref('')

const closeModal = () => {
  emit('close')
}

const filteredAvailableTags = computed(() => {
  if (!tagSearchQuery.value) {
    return props.availableTags
  }
  const query = tagSearchQuery.value.toLowerCase()
  return props.availableTags.filter(tag => tag.toLowerCase().includes(query))
})

const toggleTag = (tag) => {
  const index = selectedTags.value.indexOf(tag)
  if (index === -1) {
    selectedTags.value.push(tag)
  } else {
    selectedTags.value.splice(index, 1)
  }
}

const removeTag = (tag) => {
  const index = selectedTags.value.indexOf(tag)
  if (index !== -1) {
    selectedTags.value.splice(index, 1)
  }
}

const clearTags = () => {
  tagSearchQuery.value = ''
  selectedTags.value = []
}

const filteredNotes = computed(() => {
  // Only show notes if there's a filter/search or show all if we want.
  // In a search modal, showing all might be too much, but for now we will just filter the list
  // Let's only display them if there's a search term or a selected tag
  if (!searchQuery.value && selectedTags.value.length === 0) {
    // If you want to show nothing when empty search:
    // return []
    // But since it's a small note app, returning all is also okay, let's limit to 50
    return props.notes.slice(0, 50)
  }

  let result = props.notes

  // Filter by tags
  if (selectedTags.value.length > 0) {
    result = result.filter(note => 
      note.tags && note.tags.some(tag => 
        selectedTags.value.some(selectedTag => 
          tag.toLowerCase() === selectedTag.toLowerCase()
        )
      )
    )
  }

  // Filter by search query
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase()
    result = result.filter(note => {
      const titleMatch = note.title && note.title.toLowerCase().includes(q)
      const idMatch = note.id && note.id.toLowerCase().includes(q)
      return titleMatch || idMatch
    })
  }

  return result
})

const addExternalTag = (tag) => {
  if (!selectedTags.value.includes(tag)) {
    selectedTags.value.push(tag)
  }
}

defineExpose({
  addExternalTag
})
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal-content {
  background: rgba(18, 19, 42, 0.98);
  border: 1px solid var(--border-light);
  border-radius: 12px;
  width: 90%;
  max-width: 600px;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1.25rem 1.5rem;
  border-bottom: 1px solid var(--border-light);
}

.modal-header h2 {
  margin: 0;
  font-size: 1.25rem;
  color: var(--text-primary);
}

.close-btn {
  background: transparent;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 0.25rem;
  border-radius: 4px;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
}

.close-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--text-primary);
}

.close-btn .mdi {
  font-size: 1.5rem;
}

.modal-body {
  padding: 1.5rem;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

/* Search input */
.search-input {
  width: 100%;
  padding: 0.75rem 1rem;
  border: 1px solid var(--border-light);
  border-radius: 8px;
  font-size: 0.95rem;
  background: rgba(26, 27, 58, 0.6);
  color: var(--text-primary);
  transition: all 0.2s ease;
  box-sizing: border-box;
}

.search-input:focus {
  outline: none;
  border-color: var(--interactive-primary);
  background: rgba(31, 32, 69, 0.8);
  box-shadow: 0 0 12px rgba(138, 92, 245, 0.2);
}

.search-input::placeholder {
  color: var(--text-tertiary);
}

/* Tag filter styles identical/adapted from TagFilter.vue */
.tag-filter-section {
  position: relative;
}

.tag-filter-toggle {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--border-light);
  border-radius: 8px;
  background: rgba(26, 27, 58, 0.6);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 0.85rem;
  transition: all 0.2s ease;
}

.tag-filter-toggle:hover,
.tag-filter-toggle.is-active {
  border-color: var(--interactive-primary);
  background: rgba(31, 32, 69, 0.8);
  color: var(--text-primary);
}

.tag-filter-toggle .tag-count {
  background: var(--interactive-primary);
  color: white;
  padding: 0.125rem 0.5rem;
  border-radius: 10px;
  font-size: 0.75rem;
  margin-left: auto;
}

.tag-filter-toggle .mdi:last-child {
  margin-left: auto;
}

.tag-filter-dropdown {
  position: absolute;
  top: calc(100% + 0.25rem);
  left: 0;
  right: 0;
  background: rgba(18, 19, 42, 0.98);
  border: 1px solid var(--border-light);
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  z-index: 100;
  max-height: 250px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.tag-search-input {
  width: 100%;
  padding: 0.5rem 0.75rem;
  border: none;
  border-bottom: 1px solid var(--border-light);
  background: transparent;
  color: var(--text-primary);
  font-size: 0.85rem;
  box-sizing: border-box;
}

.tag-search-input:focus {
  outline: none;
  background: rgba(31, 32, 69, 0.4);
}

.tag-search-input::placeholder {
  color: var(--text-tertiary);
}

.tag-list {
  flex: 1;
  overflow-y: auto;
  padding: 0.25rem;
}

.tag-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.4rem 0.6rem;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 0.85rem;
  border-radius: 4px;
  transition: all 0.15s ease;
  text-align: left;
}

.tag-item:hover {
  background: rgba(138, 92, 245, 0.15);
  color: var(--text-primary);
}

.tag-item.is-selected {
  color: var(--interactive-primary);
}

.tag-item .mdi {
  font-size: 1rem;
}

.no-tags {
  padding: 1rem;
  text-align: center;
  color: var(--text-tertiary);
  font-size: 0.85rem;
}

.clear-tags-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.5rem;
  border: none;
  border-top: 1px solid var(--border-light);
  background: rgba(239, 68, 68, 0.1);
  color: var(--status-error);
  cursor: pointer;
  font-size: 0.8rem;
  transition: all 0.15s ease;
}

.clear-tags-btn:hover {
  background: rgba(239, 68, 68, 0.2);
}

/* Selected Tags Display */
.selected-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
}

.selected-tag {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.25rem 0.5rem;
  background: rgba(138, 92, 245, 0.25);
  border: 1px solid rgba(138, 92, 245, 0.4);
  border-radius: 12px;
  color: var(--text-primary);
  font-size: 0.75rem;
  cursor: pointer;
  transition: all 0.15s ease;
}

.selected-tag:hover {
  background: rgba(138, 92, 245, 0.35);
  border-color: rgba(138, 92, 245, 0.6);
}

.selected-tag .mdi {
  font-size: 0.85rem;
  opacity: 0.7;
}

.selected-tag:hover .mdi {
  opacity: 1;
}

/* Results */
.results-section {
  flex: 1;
  overflow-y: auto;
  border-top: 1px solid var(--border-light);
  padding-top: 1rem;
  min-height: 200px;
  max-height: 350px;
}

.no-results {
  text-align: center;
  color: var(--text-secondary);
  padding: 2rem;
  font-style: italic;
}

.results-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.result-item {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 0.75rem;
  background: rgba(31, 32, 69, 0.3);
  border: 1px solid var(--border-light);
  border-radius: 8px;
  text-decoration: none;
  transition: all 0.2s ease;
}

.result-item:hover {
  background: rgba(138, 92, 245, 0.15);
  border-color: rgba(138, 92, 245, 0.4);
  transform: translateY(-1px);
}

.result-item .mdi {
  font-size: 1.25rem;
  color: var(--interactive-primary);
  margin-top: 0.1rem;
}

.result-info {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  overflow: hidden;
}

.result-title {
  color: var(--text-primary);
  font-weight: 500;
  font-size: 1rem;
}

.result-path {
  color: var(--text-secondary);
  font-size: 0.8rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
