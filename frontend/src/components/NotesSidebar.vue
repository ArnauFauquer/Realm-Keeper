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

      </div>

      <div class="sidebar-header">
        <button class="action-btn" @click="isSearchModalOpen = true">
          <span class="mdi mdi-magnify"></span>
          <span>Search Notes</span>
        </button>
        <button class="action-btn" @click="isGraphModalOpen = true">
          <span class="mdi mdi-graph-outline"></span>
          <span>View Graph</span>
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
      @close="isGraphModalOpen = false"
    />
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import TreeItem from './TreeItem.vue'
import SearchModal from './SearchModal.vue'
import GraphModal from './GraphModal.vue'
import { useNotes } from '@/composables/useNotes'

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
const isGraphModalOpen = ref(false)
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
  gap: 0.5rem;
  font-size: 1.2rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 1rem;
}

.app-title .mdi {
  font-size: 1.5rem;
  background: linear-gradient(90deg, #22d3ee 0%, #a78bfa 50%, #f472b6 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text; /* Added standard property */
}

.app-title .title-text {
  background: linear-gradient(90deg, #22d3ee 0%, #a78bfa 50%, #f472b6 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text; /* Added standard property */
}

/* Action Buttons */
.action-btn {
  width: 100%;
  padding: 0.625rem 0.875rem;
  border: 1px solid var(--border-light);
  border-radius: 8px;
  font-size: 0.9rem;
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
  font-size: 0.9rem;
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
  font-size: 0.85rem;
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
  font-size: 0.9rem;
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
