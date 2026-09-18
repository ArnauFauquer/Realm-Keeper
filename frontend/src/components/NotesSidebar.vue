<template>
  <div>
    <!-- Mobile overlay -->
    <div 
      v-if="isOpen" 
      class="sidebar-overlay"
      @click="closeSidebar"
    ></div>
    
    <!-- Mobile toggle button -->
    <button 
      class="sidebar-toggle"
      :class="{ 'is-open': isOpen }"
      @click="toggleSidebar"
      aria-label="Toggle sidebar"
    >
      <span class="mdi" :class="isOpen ? 'mdi-close' : 'mdi-menu'"></span>
    </button>
    
    <div class="sidebar" :class="{ 'is-open': isOpen }">
      <div class="sidebar-top-section">
        <div class="app-title">
          <span class="mdi mdi-orbit"></span>
          <span class="title-text">RealmKeeper</span>
        </div>

        <div v-if="user && !user.local" class="user-chip">
          <div class="user-avatar">{{ userInitial }}</div>
          <span class="user-email" :title="user.email">{{ user.email }}</span>
          <button class="logout-btn" title="Sign out" @click="logout">
            <span class="mdi mdi-logout-variant"></span>
          </button>
        </div>
        <button v-else-if="!user" class="sign-in-btn" @click="login">
          <span class="mdi mdi-login-variant"></span>
          <span>Sign in</span>
        </button>
      </div>

      <div class="sidebar-header">
        <button class="action-btn" @click="isSearchModalOpen = true">
          <span class="mdi mdi-magnify"></span>
          <span>Search Notes</span>
        </button>
        <button
          class="action-btn"
          :class="{ disabled: !user }"
          :disabled="!user"
          :title="user ? '' : 'Sign in to use the player'"
          @click="isPlayerModalOpen = true"
        >
          <span class="mdi mdi-music-box-multiple-outline"></span>
          <span>Player</span>
        </button>
        <button class="action-btn" @click="openCharts">
          <span class="mdi mdi-map-marker-radius"></span>
          <span>Charts</span>
        </button>
      </div>

      <div v-if="loading && notes.length === 0" class="loading-state">
        <div class="loading-spinner"></div>
        <p>Loading your notes...</p>
      </div>
      <div v-else-if="error" class="error">{{ error }}</div>
      
      <div v-else class="notes-tree-wrapper">
        <div class="notes-tree" ref="treeContainer">
          <TreeItem 
            v-for="item in notesTree" 
            :key="item.path || item.id"
            :item="item"
            :level="0"
            @toggle="toggleFolder"
            @note-click="closeSidebar"
          />
        </div>
        
        <!-- Infinite scroll indicator -->
        <div v-if="hasMore" class="infinite-scroll-area" ref="scrollIndicator">
          <div v-if="isLoadingMore" class="loading-more">
            <div class="mini-spinner"></div>
            <span>Loading more notes...</span>
          </div>
          <div v-else class="scroll-hint">
            <span class="mdi mdi-chevron-down"></span>
            <span>Scroll for more</span>
          </div>
        </div>
      </div>

      <div v-if="user" class="sidebar-footer">
        <button class="new-note-trigger" @click="startNewNote">
          <span class="mdi mdi-plus"></span>
          <span>New Note</span>
        </button>
      </div>
    </div>

    <SearchModal
      ref="searchModalRef"
      :is-open="isSearchModalOpen"
      :notes="notes"
      :available-tags="availableTags"
      @close="isSearchModalOpen = false"
    />
    <GraphModal
      :is-open="isGraphModalOpen"
      @close="closeGraphModal"
    />
    <PlayerModal
      :is-open="isPlayerModalOpen"
      @close="isPlayerModalOpen = false"
    />
    <ChartsModal :notes="notes" />

    <div v-if="showNewNoteInput" class="modal-overlay" @click.self="showNewNoteInput = false">
      <div class="new-note-modal">
        <div class="modal-header">
          <h2><span class="mdi mdi-note-plus-outline"></span> New Note</h2>
          <button class="close-btn" @click="showNewNoteInput = false">
            <span class="mdi mdi-close"></span>
          </button>
        </div>
        <div class="modal-body">
          <label class="field-label" for="new-note-path">Note path</label>
          <input
            id="new-note-path"
            ref="newNoteInputRef"
            v-model="newNotePath"
            class="new-note-input"
            placeholder="Oneshots/My New Adventure"
            @keyup.enter="submitNewNote"
            @keyup.esc="showNewNoteInput = false"
          />
          <p class="field-hint">Use <code>/</code> to place it inside a folder.</p>
        </div>
        <div class="modal-actions">
          <button class="modal-btn cancel" @click="showNewNoteInput = false">Cancel</button>
          <button class="modal-btn primary" :disabled="!newNotePath.trim()" @click="submitNewNote">Create Note</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import TreeItem from './TreeItem.vue'
import SearchModal from './SearchModal.vue'
import GraphModal from './GraphModal.vue'
import PlayerModal from './PlayerModal.vue'
import ChartsModal from './ChartsModal.vue'
import { useNotes } from '@/composables/useNotes'
import { useAuth } from '@/composables/useAuth'
import { useGraphModal } from '@/composables/useGraphModal'
import { useChartsModal } from '@/composables/useChartsModal'

const router = useRouter()
const { user, login, logout } = useAuth()
const { isOpen: isGraphModalOpen, close: closeGraphModal } = useGraphModal()
const { open: openCharts } = useChartsModal()

const userInitial = computed(() => user.value?.email?.[0]?.toUpperCase() || '?')

const showNewNoteInput = ref(false)
const newNotePath = ref('')
const newNoteInputRef = ref(null)

function startNewNote() {
  showNewNoteInput.value = true
  nextTick(() => newNoteInputRef.value?.focus())
}

function submitNewNote() {
  const path = newNotePath.value.trim().replace(/^\/+|\/+$/g, '')
  if (!path) return
  newNotePath.value = ''
  showNewNoteInput.value = false
  closeSidebar()
  router.push(`/note/${path.split('/').map(encodeURIComponent).join('/')}?new=1`)
}

const {
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
} = useNotes()

const expandedFolders = ref(new Set())
const isOpen = ref(false)
const isSearchModalOpen = ref(false)
const isPlayerModalOpen = ref(false)
const searchModalRef = ref(null)
const scrollIndicator = ref(null)
let scrollObserver = null

const openSearchWithTag = (tag) => {
  isSearchModalOpen.value = true
  nextTick(() => {
    if (searchModalRef.value) {
      searchModalRef.value.addExternalTag(tag)
    }
  })
}

defineExpose({
  openSearchWithTag
})

/**
 * Computes a nested tree structure out of flat note arrays depending on tag filters.
 * 
 * Algorithm:
 * 1. Iterates over notes and extracts their folder path chunks.
 * 2. Builds `folderMap` to construct standard directories as intermediate tree branches.
 * 3. Assesses the actual markdown notes parsing if a note behaves as a "folder note"
 *    (named precisely after the directory) to avoid rendering redundant list elements.
 * 4. Fills the root level array connecting orphaned notes or branch roots.
 */
const notesTree = computed(() => {
  const root = []
  const folderMap = {}
  
  const safeNotes = Array.isArray(notes.value) ? notes.value : []
  safeNotes.forEach(note => {
    const parts = note.id.split('/')
    
    // Create folders
    for (let i = 0; i < parts.length - 1; i++) {
      const folderPath = parts.slice(0, i + 1).join('/')
      if (!folderMap[folderPath]) {
        folderMap[folderPath] = {
          path: folderPath,
          name: parts[i],
          isFolder: true,
          expanded: expandedFolders.value.has(folderPath),
          children: [],
          notes: []
        }
        if (i === 0) root.push(folderMap[folderPath])
        else folderMap[parts.slice(0, i).join('/')].children.push(folderMap[folderPath])
      }
    }

    const parentPath = parts.slice(0, -1).join('/')
    if (parentPath) folderMap[parentPath].notes.push(note)
    else root.push({ ...note, isFolder: false })
  })
  
  return root
})

const toggleFolder = (path) => {
  const newExpanded = new Set(expandedFolders.value)
  if (newExpanded.has(path)) {
    newExpanded.delete(path)
  } else {
    newExpanded.add(path)
  }
  expandedFolders.value = newExpanded
}

const toggleSidebar = () => {
  isOpen.value = !isOpen.value
  document.body.style.overflow = isOpen.value ? 'hidden' : ''
}

const closeSidebar = () => {
  isOpen.value = false
  document.body.style.overflow = ''
}

const setupScrollObserver = () => {
  nextTick(() => {
    if (!scrollIndicator.value) return
    
    if (scrollObserver) {
      scrollObserver.disconnect()
    }
    
    scrollObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting && !isLoadingMore.value && hasMore.value) {
            loadMoreNotes()
          }
        })
      },
      { threshold: 0.1 }
    )
    
    scrollObserver.observe(scrollIndicator.value)
  })
}



watch(notes, () => {
  setupScrollObserver()
})

onMounted(() => {
  fetchNotes()
  fetchTags()
  setupScrollObserver()
})

onBeforeUnmount(() => {
  document.body.style.overflow = ''
  if (scrollObserver) {
    scrollObserver.disconnect()
  }
})
</script>

<style scoped>
.sidebar {
  width: 300px;
  height: 100vh;
  background: rgba(12, 13, 29, 0.85);
  backdrop-filter: blur(12px);
  border-right: 1px solid var(--border-light);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.sidebar-header {
  padding: 1rem;
  background: rgba(18, 19, 42, 0.6);
  border-bottom: 1px solid var(--border-light);
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.sidebar-top-section {
  padding: 1rem;
  background: rgba(12, 13, 29, 0.85);
  border-bottom: 1px solid var(--border-light);
}

.app-title {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  font-size: 2rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 1rem;
}

.app-title .mdi {
  font-size: 2.35rem;
  background: linear-gradient(90deg, #22d3ee 0%, #a78bfa 50%, #f472b6 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text; /* Added standard property */
}

.app-title .title-text {
  font-family: var(--font-display);
  background: linear-gradient(90deg, #22d3ee 0%, #a78bfa 50%, #f472b6 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text; /* Added standard property */
}

.user-chip {
  display: flex;
  align-items: center;
  gap: 0.55rem;
}

.user-avatar {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  font-weight: 700;
  color: #0c0d1d;
  background: linear-gradient(135deg, #22d3ee 0%, #a78bfa 50%, #f472b6 100%);
}

.user-email {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.8rem;
  color: var(--text-secondary);
}

.logout-btn {
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  background: transparent;
  border: none;
  color: var(--text-tertiary);
  cursor: pointer;
  transition: all 0.15s ease;
}

.logout-btn:hover {
  background: rgba(248, 113, 113, 0.12);
  color: var(--status-error, #f87171);
}

.logout-btn .mdi {
  font-size: 1.1rem;
}

.sign-in-btn {
  width: 100%;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--border-medium);
  border-radius: 8px;
  font-size: 0.8rem;
  background: var(--interactive-secondary);
  color: var(--text-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.sign-in-btn:hover {
  border-color: var(--interactive-primary);
  background: rgba(138, 92, 245, 0.25);
}

.sign-in-btn .mdi {
  font-size: 1.05rem;
}

/* Action Buttons */
.action-btn {
  width: 100%;
  padding: 0.625rem 0.875rem;
  border: 1px solid var(--border-light);
  border-radius: 8px;
  font-size: 0.875rem;
  background: rgba(26, 27, 58, 0.6);
  color: var(--text-secondary);
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  cursor: pointer;
}

.action-btn:hover {
  border-color: var(--interactive-primary);
  background: rgba(31, 32, 69, 0.8);
  color: var(--text-primary);
  box-shadow: 0 0 12px rgba(138, 92, 245, 0.2);
}

.action-btn .mdi {
  font-size: 1.1rem;
}

.action-btn.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.action-btn.disabled:hover {
  border-color: var(--border-light);
  background: rgba(26, 27, 58, 0.6);
  color: var(--text-secondary);
  box-shadow: none;
}

.sidebar-footer {
  flex-shrink: 0;
  padding: 0.75rem;
  border-top: 1px solid var(--border-light);
  background: rgba(12, 13, 29, 0.85);
}

.new-note-trigger {
  width: 100%;
  padding: 0.625rem 0.875rem;
  border: 1px dashed var(--border-medium);
  border-radius: 8px;
  font-size: 0.875rem;
  background: transparent;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.new-note-trigger:hover {
  border-style: solid;
  border-color: var(--interactive-primary);
  background: var(--interactive-secondary);
  color: var(--text-primary);
}

.new-note-trigger .mdi {
  font-size: 1.1rem;
}

/* ── New Note modal ─────────────────────────────────────────── */
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
}

.new-note-modal {
  background: rgba(18, 19, 42, 0.98);
  border: 1px solid var(--border-light);
  border-radius: 12px;
  width: min(90vw, 420px);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
}

.new-note-modal .modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1.1rem 1.4rem;
  border-bottom: 1px solid var(--border-light);
}

.new-note-modal .modal-header h2 {
  margin: 0;
  font-size: 1.25rem;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.new-note-modal .close-btn {
  background: transparent;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 0.25rem;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}

.new-note-modal .close-btn .mdi {
  font-size: 1.5rem;
}

.new-note-modal .close-btn:hover {
  background: var(--interactive-secondary);
  color: var(--text-primary);
}

.new-note-modal .modal-body {
  padding: 1.4rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.field-label {
  font-size: 0.875rem;
  color: var(--text-secondary);
  font-weight: 500;
}

.new-note-input {
  background: rgba(26, 27, 58, 0.6);
  border: 1px solid var(--border-light);
  border-radius: 8px;
  padding: 0.625rem 0.8rem;
  color: var(--text-primary);
  font-size: 1rem;
}

.new-note-input:focus {
  outline: none;
  border-color: var(--interactive-primary);
}

.field-hint {
  margin: 0;
  font-size: 0.8rem;
  color: var(--text-tertiary);
}

.field-hint code {
  background: rgba(138, 92, 245, 0.15);
  padding: 0.1rem 0.35rem;
  border-radius: 4px;
  color: #c4b5fd;
  font-family: 'SF Mono', 'Monaco', 'Courier New', monospace;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  padding: 0.75rem 1.4rem 1.4rem;
}

.modal-btn {
  padding: 0.625rem 1.25rem;
  border-radius: 8px;
  font-size: 0.875rem;
  cursor: pointer;
  transition: all 0.2s ease;
  border: 1px solid transparent;
}

.modal-btn.cancel {
  background: transparent;
  border-color: var(--border-light);
  color: var(--text-secondary);
}

.modal-btn.cancel:hover {
  background: var(--interactive-secondary);
  color: var(--text-primary);
}

.modal-btn.primary {
  background: var(--interactive-primary);
  border-color: var(--interactive-primary);
  color: white;
}

.modal-btn.primary:hover {
  background: var(--interactive-primaryHover);
}

.modal-btn.primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.notes-tree-wrapper {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.notes-tree {
  flex: 1;
  overflow-y: auto;
  padding: 0.5rem;
  display: flex;
  flex-direction: column;
}

.notes-tree::-webkit-scrollbar {
  width: 6px;
}

.notes-tree::-webkit-scrollbar-track {
  background: transparent;
}

.notes-tree::-webkit-scrollbar-thumb {
  background: rgba(138, 92, 245, 0.3);
  border-radius: 3px;
  transition: background 0.2s ease;
}

.notes-tree::-webkit-scrollbar-thumb:hover {
  background: rgba(138, 92, 245, 0.6);
}

/* Loading State */
.loading-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  padding: 2rem 1rem;
  color: var(--text-secondary);
  background: radial-gradient(circle at center, rgba(138, 92, 245, 0.1), transparent);
}

.loading-spinner {
  width: 48px;
  height: 48px;
  border: 3px solid rgba(138, 92, 245, 0.2);
  border-top-color: var(--interactive-primary);
  border-radius: 50%;
  animation: spin 0.9s linear infinite;
  box-shadow: 0 0 16px rgba(138, 92, 245, 0.2);
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.loading-state p {
  font-size: 0.875rem;
  opacity: 0.8;
  margin: 0;
  letter-spacing: 0.3px;
}

/* Infinite Scroll Indicator */
.infinite-scroll-area {
  padding: 1.25rem 0.5rem 0.75rem;
  text-align: center;
  border-top: 1px solid rgba(138, 92, 245, 0.15);
  background: linear-gradient(to top, rgba(138, 92, 245, 0.08), rgba(138, 92, 245, 0.02), transparent);
  min-height: 70px;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: hidden;
}

.infinite-scroll-area::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(to right, transparent, rgba(138, 92, 245, 0.3), transparent);
  opacity: 0.5;
}

.loading-more {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  padding: 0.85rem 1.5rem;
  color: var(--text-secondary);
  font-size: 0.8rem;
  animation: fadeIn 0.4s ease;
  background: rgba(138, 92, 245, 0.12);
  border-radius: 8px;
  border: 1px solid rgba(138, 92, 245, 0.2);
  font-weight: 500;
  letter-spacing: 0.2px;
  position: relative;
  z-index: 1;
}

.mini-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(138, 92, 245, 0.2);
  border-top-color: var(--interactive-primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  flex-shrink: 0;
  box-shadow: 0 0 6px rgba(138, 92, 245, 0.3);
}

.scroll-hint {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  color: var(--text-tertiary);
  font-size: 0.8rem;
  padding: 0.75rem 1.25rem;
  animation: slideInUp 0.5s ease;
  letter-spacing: 0.5px;
  position: relative;
  z-index: 1;
}

.scroll-hint .mdi {
  font-size: 1.2rem;
  animation: bounce 1.6s ease-in-out infinite;
  color: rgba(138, 92, 245, 0.6);
}

@keyframes slideInUp {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes bounce {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(4px); }
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

/* Error and Loading States */
.loading, .error {
  padding: 1.5rem 1rem;
  text-align: center;
  color: var(--text-secondary);
  font-size: 0.875rem;
}

.error {
  color: var(--status-error);
}

/* Mobile toggle button */
.sidebar-toggle {
  display: none;
  position: fixed;
  bottom: 1.5rem;
  left: 1.5rem;
  z-index: 1001;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: linear-gradient(135deg, #8a5cf5 0%, #6366f1 100%);
  border: none;
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(138, 92, 245, 0.4);
  transition: all 0.3s ease;
}

.sidebar-toggle .mdi {
  font-size: 1.5rem;
  color: white;
}

.sidebar-toggle:hover {
  transform: scale(1.05);
  box-shadow: 0 6px 20px rgba(138, 92, 245, 0.5);
}

.sidebar-toggle.is-open {
  background: rgba(31, 32, 69, 0.95);
}

/* Mobile overlay */
.sidebar-overlay {
  display: none;
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 999;
  backdrop-filter: blur(4px);
}

/* Mobile responsive styles */
@media (max-width: 768px) {
  .sidebar-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    bottom: calc(70px + 1rem + env(safe-area-inset-bottom, 0px));
  }

  .sidebar-overlay {
    display: block;
  }

  .sidebar {
    position: fixed;
    top: 0;
    left: 0;
    z-index: 1000;
    width: 85%;
    max-width: 320px;
    height: calc(100vh - 70px - env(safe-area-inset-bottom, 0px));
    transform: translateX(-100%);
    transition: transform 0.3s ease;
    box-shadow: 4px 0 24px rgba(0, 0, 0, 0.3);
  }

  .sidebar.is-open {
    transform: translateX(0);
  }
}
</style>
