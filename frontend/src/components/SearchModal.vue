<template>
  <div v-if="isOpen" class="rk-scrim search-scrim" @click.self="closeModal">
    <div class="rk-dialog search-dialog" role="dialog" aria-modal="true" aria-labelledby="search-modal-title">
      <h2 id="search-modal-title" class="rk-visually-hidden">Search</h2>

      <div class="search-bar">
        <span class="mdi mdi-magnify search-icon" aria-hidden="true"></span>
        <input
          ref="inputRef"
          v-model="searchQuery"
          type="text"
          :placeholder="user ? 'Search notes, charts, vistas, encounters, sheets, images' : 'Search notes'"
          aria-label="Search"
          class="search-input"
          role="combobox"
          aria-controls="search-results"
          :aria-expanded="results.length > 0"
          :aria-activedescendant="activeIndex >= 0 ? `search-result-${activeIndex}` : undefined"
          @keydown.down.prevent="move(1)"
          @keydown.up.prevent="move(-1)"
          @keydown.enter.prevent="openResult(results[activeIndex])"
        />
        <button class="search-close" aria-label="Close search" @click="closeModal"><kbd>Esc</kbd></button>
      </div>

      <div class="search-filters">
        <div class="tag-filter-section">
          <button
            class="tag-filter-toggle"
            :class="{ 'is-active': showTagFilter || selectedTags.length }"
            :aria-expanded="showTagFilter"
            @click="showTagFilter = !showTagFilter"
          >
            <span class="mdi mdi-tag-multiple-outline" aria-hidden="true"></span>
            <span>Tags</span>
            <span v-if="selectedTags.length" class="tag-count">{{ selectedTags.length }}</span>
            <span class="mdi chevron" :class="showTagFilter ? 'mdi-chevron-up' : 'mdi-chevron-down'" aria-hidden="true"></span>
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

      <div id="search-results" class="results-section" role="listbox" aria-label="Results">
        <div v-if="results.length === 0" class="rk-empty no-results">
          <span class="mdi mdi-file-search-outline"></span>
          <p>Nothing matches “{{ searchQuery || selectedTags.join(', ') }}”.</p>
          <p class="rk-hint">Try a shorter search, or clear the tag filters.</p>
        </div>
        <template v-else>
          <template v-for="group in groups" :key="group.title">
            <p class="results-group">{{ group.title }}</p>
            <component
              :is="entry.note ? 'router-link' : 'button'"
              v-for="entry in group.entries"
              :id="`search-result-${entry.index}`"
              :key="entry.key"
              v-bind="entry.note ? { to: noteUrl(entry.note) } : { type: 'button' }"
              class="result-item"
              :class="{ 'is-active': entry.index === activeIndex }"
              role="option"
              :aria-selected="entry.index === activeIndex"
              @mousemove="activeIndex = entry.index"
              @click="openResult(entry, $event)"
            >
              <span class="result-mark" aria-hidden="true">
                <img v-if="entry.thumb" :src="resolveUrl(entry.thumb)" alt="" />
                <span v-else class="mdi" :class="entry.icon"></span>
              </span>
              <span class="result-info">
                <span class="result-title">{{ entry.title }}</span>
                <span class="result-path">{{ entry.path }}</span>
              </span>
              <span v-if="entry.kindLabel" class="result-kind">{{ entry.kindLabel }}</span>
            </component>
            <button v-if="group.hidden" type="button" class="results-more" @click="expanded[group.key] = true">
              Show {{ group.hidden }} more {{ group.hidden === 1 ? group.one : group.many }}
            </button>
          </template>
          <p v-if="searching" class="results-group results-loading" role="status">Searching the Observatory...</p>
        </template>
      </div>

      <footer class="search-footer" aria-hidden="true">
        <span><kbd>↑</kbd><kbd>↓</kbd> to move</span>
        <span><kbd>↵</kbd> to open</span>
        <span><kbd>Esc</kbd> to close</span>
      </footer>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { observatoryApi } from '@/api/observatory'
import { noteRoute } from '@/utils/paths'
import { useAuth } from '@/composables/useAuth'
import { useDocModal } from '@/composables/useDocModal'
import { useObservatoryModal } from '@/composables/useObservatoryModal'
import { DOC_TYPES, IMAGE_KIND, capitalize } from '@/utils/docTypes'
import { resolveUrl } from '@/utils/resolveUrl'

// Search across everything: the notes (for anyone), and, signed in, what is in
// the Observatory (documents of every kind and images). Arrows move through the
// results, Enter opens one: a note in the reader, a document in its editor, an
// image in its folder of the Observatory.
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

const router = useRouter()
const { user } = useAuth()
const searchQuery = ref('')
const selectedTags = ref([])
const showTagFilter = ref(false)
const tagSearchQuery = ref('')
const inputRef = ref(null)
const activeIndex = ref(0)
const observatoryItems = ref([])
const searching = ref(false)
// While searching, each group shows its first few, and the rest on asking.
const GROUP_LIMIT = 8
const expanded = ref({ notes: false, observatory: false })

const closeModal = () => {
  emit('close')
}

const onKeydown = (event) => {
  if (event.key === 'Escape') closeModal()
}

watch(() => props.isOpen, (open) => {
  if (open) {
    window.addEventListener('keydown', onKeydown)
    activeIndex.value = 0
    nextTick(() => inputRef.value?.focus())
  } else {
    window.removeEventListener('keydown', onKeydown)
  }
}, { immediate: true })

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  clearTimeout(searchTimer)
})

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
  // Nothing typed and no tag picked: the first notes, to browse.
  if (!searchQuery.value && selectedTags.value.length === 0) {
    return props.notes.slice(0, 50)
  }

  let result = props.notes

  if (selectedTags.value.length > 0) {
    result = result.filter(note =>
      note.tags && note.tags.some(tag =>
        selectedTags.value.some(selectedTag =>
          tag.toLowerCase() === selectedTag.toLowerCase()
        )
      )
    )
  }

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

// The Observatory is asked once typing pauses; tags are the notes' own.
const SEARCH_DELAY = 180
let searchTimer = null
let searchToken = 0
watch(() => [searchQuery.value.trim(), !!user.value], ([query, signedIn]) => {
  clearTimeout(searchTimer)
  const token = ++searchToken
  if (!query || !signedIn) {
    observatoryItems.value = []
    searching.value = false
    return
  }
  searching.value = true
  searchTimer = setTimeout(async () => {
    try {
      const { items } = await observatoryApi.search(query)
      if (token === searchToken) observatoryItems.value = items
    } catch {
      if (token === searchToken) observatoryItems.value = []
    } finally {
      if (token === searchToken) searching.value = false
    }
  }, SEARCH_DELAY)
})

const kindOf = (item) => (item.kind === 'image' ? IMAGE_KIND : DOC_TYPES[item.kind])

function thumbOf(item) {
  if (item.kind === 'image') return item.url
  const field = DOC_TYPES[item.kind]?.imageField
  return field ? item[field] : null
}

const capped = (list, key) => {
  const limited = searchQuery.value.trim() && !expanded.value[key]
  return limited ? list.slice(0, GROUP_LIMIT) : list
}

const allNotes = computed(() => filteredNotes.value.map((note) => ({
  key: `note:${note.id}`, note, title: note.title || note.id.split('/').pop(), path: note.id,
  icon: 'mdi-file-document-outline'
})))
const allFound = computed(() => (selectedTags.value.length ? [] : observatoryItems.value).map((item) => ({
  key: `${item.kind}:${item.id}`, item, title: item.name, path: item.folder || 'Observatory',
  icon: kindOf(item).icon, thumb: thumbOf(item), kindLabel: capitalize(kindOf(item).label)
})))

// One list, in the order shown, so the arrows go through notes and then the Observatory.
const results = computed(() =>
  [...capped(allNotes.value, 'notes'), ...capped(allFound.value, 'observatory')].map((entry, index) => ({ ...entry, index }))
)

const groups = computed(() => [
  { key: 'notes', title: 'Notes', one: 'note', many: 'notes', all: allNotes.value.length, entries: results.value.filter((entry) => entry.note) },
  { key: 'observatory', title: 'Observatory', one: 'result', many: 'results', all: allFound.value.length, entries: results.value.filter((entry) => entry.item) }
].filter((group) => group.entries.length).map((group) => ({ ...group, hidden: group.all - group.entries.length })))

watch(results, () => {
  if (activeIndex.value >= results.value.length) activeIndex.value = 0
})
watch(searchQuery, () => {
  activeIndex.value = 0
  expanded.value = { notes: false, observatory: false }
})

function move(by) {
  const count = results.value.length
  if (!count) return
  activeIndex.value = (activeIndex.value + by + count) % count
  nextTick(() => document.getElementById(`search-result-${activeIndex.value}`)?.scrollIntoView?.({ block: 'nearest' }))
}

const noteUrl = (note) => noteRoute(note.id)

function openResult(entry, event) {
  if (!entry) return
  if (entry.note) {
    // A click on the link navigates by itself; Enter does it here.
    if (!event) router.push(noteUrl(entry.note))
    closeModal()
    return
  }
  event?.preventDefault()
  closeModal()
  if (entry.item.kind === 'image') useObservatoryModal().open(entry.item.folder)
  else useDocModal(entry.item.kind).open(entry.item.id)
}

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
/* A command palette: held near the top, so results grow downwards. */
.search-scrim {
  align-items: flex-start;
  padding-top: min(12vh, 7rem);
}

.search-dialog {
  width: min(100%, 640px);
  max-height: min(78dvh, calc(100dvh - 2 * var(--space-4)));
  padding: 0;
  gap: 0;
  overflow: hidden;
}

.search-bar {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--border-light);
}

.search-icon {
  font-size: 1.35rem;
  color: var(--accent-soft);
}

.search-input {
  flex: 1;
  min-width: 0;
  min-height: 2.5rem;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: var(--text-md);
}

.search-input:focus,
.search-input:focus-visible {
  outline: none;
  box-shadow: none;
}

.search-input::placeholder {
  color: var(--text-muted);
}

.search-close {
  border: none;
  background: transparent;
  padding: 0;
}

kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.4rem;
  height: 1.4rem;
  padding: 0 0.35rem;
  border: 1px solid var(--border-medium);
  border-bottom-width: 2px;
  border-radius: var(--radius-sm);
  background: var(--surface-sunken);
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 0.7rem;
  line-height: 1;
}

.search-close:hover kbd {
  color: var(--text-primary);
  border-color: var(--accent-a45);
}

.search-filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
  border-bottom: 1px solid var(--border-light);
}

.tag-filter-section {
  position: relative;
}

.tag-filter-toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  min-height: var(--control-sm);
  padding: 0 var(--space-2);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--text-xs);
  transition:
    background-color var(--duration-fast) var(--ease-out),
    border-color var(--duration-fast) var(--ease-out),
    color var(--duration-fast) var(--ease-out);
}

.tag-filter-toggle:hover,
.tag-filter-toggle.is-active {
  border-color: var(--accent-a45);
  background: var(--hover-tint);
  color: var(--text-primary);
}

.tag-filter-toggle .tag-count {
  padding: 0.0625rem var(--space-1);
  border-radius: var(--radius-sm);
  background: var(--accent-strong);
  color: var(--accent-contrast);
  font-size: 0.7rem;
  line-height: var(--leading-tight);
}

.tag-filter-dropdown {
  position: absolute;
  top: calc(100% + var(--space-1));
  left: 0;
  z-index: var(--z-sticky);
  width: 16rem;
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
}

.selected-tag {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  min-height: var(--control-sm);
  padding: 0 var(--space-2);
  border: 1px solid var(--accent-a45);
  border-radius: var(--radius-sm);
  background: var(--accent-a20);
  color: var(--text-primary);
  font-size: var(--text-xs);
}

.selected-tag:hover {
  background: var(--accent-a30);
  border-color: var(--accent);
}

.selected-tag .mdi {
  font-size: 0.875rem;
  opacity: 0.7;
}

.results-section {
  flex: 1;
  min-height: 200px;
  overflow-y: auto;
  padding: var(--space-2);
}

.results-group {
  margin: var(--space-2) var(--space-2) var(--space-1);
  color: var(--text-muted);
  font-size: var(--text-xs);
  font-weight: 500;
}

.results-loading {
  font-weight: 400;
}

.results-more {
  width: 100%;
  margin: 2px 0 var(--space-1);
  padding: var(--space-1) var(--space-2) var(--space-1) calc(var(--space-2) + 2.25rem + var(--space-3));
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--accent-soft);
  font-size: var(--text-xs);
  text-align: left;
}

.results-more:hover {
  background: var(--hover-tint);
}

.result-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  padding: var(--space-2);
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: inherit;
  text-align: left;
  text-decoration: none;
}

.result-item.is-active {
  background: var(--accent-a12);
  box-shadow: inset 0 0 0 1px var(--accent-a30);
}

.result-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 2.25rem;
  height: 2.25rem;
  overflow: hidden;
  border-radius: var(--radius-sm);
  background: var(--surface-sunken);
  color: var(--accent-soft);
  font-size: 1.15rem;
}

.result-mark img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.result-info {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.result-title {
  overflow: hidden;
  color: var(--text-primary);
  font-size: var(--text-sm);
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result-path {
  overflow: hidden;
  color: var(--text-muted);
  font-size: var(--text-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result-kind {
  flex-shrink: 0;
  color: var(--text-secondary);
  font-size: var(--text-xs);
}

.search-footer {
  display: flex;
  gap: var(--space-4);
  padding: var(--space-2) var(--space-4);
  border-top: 1px solid var(--border-light);
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.search-footer span {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

@media (max-width: 640px) {
  .search-scrim {
    padding-top: var(--space-4);
  }

  .search-footer {
    display: none;
  }
}
</style>
