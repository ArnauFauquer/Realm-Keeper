<template>
  <div v-if="isOpen" class="rk-scrim" @click.self="closeModal">
    <div class="rk-dialog search-dialog" role="dialog" aria-modal="true" aria-labelledby="search-modal-title">
      <div class="rk-dialog__header">
        <h2 id="search-modal-title" class="rk-dialog__title">Search Notes</h2>
        <button class="rk-icon-btn" aria-label="Close search" @click="closeModal">
          <span class="mdi mdi-close"></span>
        </button>
      </div>

      <div class="rk-dialog__body search-body">
        <div class="search-section">
          <span class="mdi mdi-magnify search-icon" aria-hidden="true"></span>
          <input
            v-model="searchQuery"
            type="text"
            placeholder="Search notes..."
            aria-label="Search notes"
            class="rk-input search-input"
          />
        </div>

        <div class="tag-filter-section">
          <button
            class="tag-filter-toggle"
            :class="{ 'is-active': showTagFilter }"
            :aria-expanded="showTagFilter"
            @click="showTagFilter = !showTagFilter"
          >
            <span class="mdi mdi-tag-multiple"></span>
            <span>Tags</span>
            <span v-if="selectedTags.length" class="tag-count">{{ selectedTags.length }}</span>
            <span class="mdi chevron" :class="showTagFilter ? 'mdi-chevron-up' : 'mdi-chevron-down'"></span>
          </button>

          <div v-if="showTagFilter" class="tag-filter-dropdown">
            <input
              v-model="tagSearchQuery"
              type="text"
              placeholder="Search tags..."
              aria-label="Search tags"
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
          <button
            v-for="tag in selectedTags"
            :key="tag"
            class="selected-tag"
            :aria-label="`Remove tag ${tag}`"
            @click="removeTag(tag)"
          >
            {{ tag }}
            <span class="mdi mdi-close"></span>
          </button>
        </div>

        <div class="results-section">
          <div v-if="filteredNotes.length === 0" class="rk-empty no-results">
            <span class="mdi mdi-file-search-outline"></span>
            <p>No notes found matching your criteria.</p>
            <p class="rk-hint">Try a shorter search, or clear the tag filters.</p>
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
import { ref, computed, watch, onBeforeUnmount } from 'vue'

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

const onKeydown = (event) => {
  if (event.key === 'Escape') closeModal()
}

watch(() => props.isOpen, (open) => {
  if (open) window.addEventListener('keydown', onKeydown)
  else window.removeEventListener('keydown', onKeydown)
}, { immediate: true })

onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

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
/* Shell comes from .rk-scrim / .rk-dialog; only the width is search-specific. */
.search-dialog {
  width: min(100%, 600px);
  max-height: min(85dvh, calc(100dvh - 2 * var(--space-4)));
}

/* Search input */
.search-section {
  position: relative;
}

.search-icon {
  position: absolute;
  left: var(--space-3);
  top: 50%;
  transform: translateY(-50%);
  font-size: 1.2rem;
  color: var(--text-muted);
  pointer-events: none;
}

.search-input {
  padding-left: calc(var(--space-3) + 1.2rem + var(--space-2));
}

/* Tag filter styles identical/adapted from TagFilter.vue */
.tag-filter-section {
  position: relative;
}

.tag-filter-toggle {
  width: 100%;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--control-md);
  padding: 0 var(--space-3);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  background: var(--surface-raised);
  color: var(--text-secondary);
  font-size: var(--text-sm);
  transition:
    background-color var(--duration-fast) var(--ease-out),
    border-color var(--duration-fast) var(--ease-out),
    color var(--duration-fast) var(--ease-out),
    transform var(--duration-fast) var(--ease-out);
}

.tag-filter-toggle:hover,
.tag-filter-toggle.is-active {
  border-color: var(--accent);
  background: var(--surface-raised-hover);
  color: var(--text-primary);
}

.tag-filter-toggle:active {
  transform: translateY(1px);
}

.tag-filter-toggle .tag-count {
  margin-left: auto;
  padding: 0.125rem var(--space-2);
  border-radius: var(--radius-full);
  background: var(--accent-strong);
  color: var(--accent-contrast);
  font-size: var(--text-xs);
  line-height: var(--leading-tight);
}

.tag-filter-toggle .chevron {
  margin-left: auto;
}

.tag-filter-toggle .tag-count + .chevron {
  margin-left: 0;
}

.tag-filter-dropdown {
  position: absolute;
  top: calc(100% + var(--space-1));
  left: 0;
  right: 0;
  z-index: var(--z-sticky);
  max-height: 250px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  background: var(--surface-overlay);
  box-shadow: var(--shadow-lg);
  animation: rk-fade-in var(--duration-fast) var(--ease-out);
}

.tag-search-input {
  width: 100%;
  min-height: var(--control-md);
  padding: 0 var(--space-3);
  border: none;
  border-bottom: 1px solid var(--border-light);
  background: transparent;
  color: var(--text-primary);
  font-size: var(--text-sm);
}

.tag-search-input:focus,
.tag-search-input:focus-visible {
  outline: none;
  box-shadow: none;
  border-radius: 0;
  background: var(--hover-tint);
}

.tag-search-input::placeholder {
  color: var(--text-muted);
}

.tag-list {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-1);
}

.tag-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  padding: 0.4rem var(--space-2);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  text-align: left;
  transition: background-color var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out);
}

.tag-item:hover {
  background: var(--hover-tint);
  color: var(--text-primary);
}

.tag-item.is-selected {
  color: var(--accent-hover);
}

.tag-item .mdi {
  font-size: 1rem;
}

.no-tags {
  padding: var(--space-4);
  text-align: center;
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.clear-tags-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  padding: var(--space-2);
  border: none;
  border-top: 1px solid var(--border-light);
  background: var(--status-error-bg);
  color: var(--status-error);
  font-size: var(--text-xs);
  transition: background-color var(--duration-fast) var(--ease-out);
}

.clear-tags-btn:hover {
  background: rgba(248, 113, 113, 0.18);
}

.clear-tags-btn:active {
  background: rgba(248, 113, 113, 0.24);
}

/* Selected Tags Display */
.selected-tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}

.selected-tag {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--accent-a45);
  border-radius: var(--radius-full);
  background: var(--accent-a20);
  color: var(--text-primary);
  font-size: var(--text-xs);
  transition:
    background-color var(--duration-fast) var(--ease-out),
    border-color var(--duration-fast) var(--ease-out),
    transform var(--duration-fast) var(--ease-out);
}

.selected-tag:hover {
  background: var(--accent-a30);
  border-color: var(--accent);
}

.selected-tag:active {
  transform: scale(0.97);
}

.selected-tag .mdi {
  font-size: 0.875rem;
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
  padding-top: var(--space-4);
  min-height: 200px;
  max-height: 350px;
}

.results-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.result-item {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-3);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  background: var(--surface-raised);
  text-decoration: none;
  transition:
    background-color var(--duration-fast) var(--ease-out),
    border-color var(--duration-fast) var(--ease-out),
    transform var(--duration-fast) var(--ease-out);
}

.result-item:hover {
  background: var(--accent-a12);
  border-color: var(--accent-a45);
  transform: translateY(-1px);
}

.result-item:active {
  transform: translateY(0);
}

.result-item .mdi {
  font-size: 1.25rem;
  color: var(--accent);
  margin-top: 0.1rem;
}

.result-info {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  overflow: hidden;
}

.result-title {
  color: var(--text-primary);
  font-weight: 500;
  font-size: var(--text-md);
}

.result-path {
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
