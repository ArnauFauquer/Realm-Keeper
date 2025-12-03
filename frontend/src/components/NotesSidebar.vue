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
      <div class="sidebar-header">
        <input 
          v-model="searchQuery" 
          type="text" 
          placeholder="Buscar notas..." 
          class="search-input"
        />
        
        <!-- Tag Filter Section -->
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
              placeholder="Buscar tags..."
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
                No se encontraron tags
              </div>
            </div>
            <button 
              v-if="selectedTags.length > 0"
              class="clear-tags-btn"
              @click="clearTags"
            >
              <span class="mdi mdi-close-circle"></span>
              Limpiar filtros
            </button>
          </div>
        </div>
        
        <!-- Selected Tags Display -->
        <div v-if="selectedTags.length > 0" class="selected-tags">
          <span 
            v-for="tag in selectedTags" 
            :key="tag" 
            class="selected-tag"
            @click="toggleTag(tag)"
          >
            {{ tag }}
            <span class="mdi mdi-close"></span>
          </span>
        </div>
      </div>
      
      <div v-if="loading" class="loading">Cargando notas...</div>
      <div v-else-if="error" class="error">{{ error }}</div>
      
      <div v-else class="notes-tree">
        <TreeItem 
          v-for="item in filteredNotesTree" 
          :key="item.path || item.id"
          :item="item"
          :level="0"
          @toggle="toggleFolder"
          @note-click="closeSidebar"
        />
      </div>
    </div>
  </div>
</template>

<script>
import axios from 'axios'
import TreeItem from './TreeItem.vue'

export default {
  name: 'NotesSidebar',
  components: {
    TreeItem
  },
  data() {
    return {
      notes: [],
      availableTags: [],
      selectedTags: [],
      loading: true,
      error: null,
      searchQuery: '',
      tagSearchQuery: '',
      showTagFilter: false,
      expandedFolders: new Set(),
      isOpen: false
    }
  },
  computed: {
    apiUrl() {
      return import.meta.env.VITE_API_URL || 'http://localhost:8000'
    },
    filteredAvailableTags() {
      if (!this.tagSearchQuery) {
        return this.availableTags
      }
      const query = this.tagSearchQuery.toLowerCase()
      return this.availableTags.filter(tag => tag.toLowerCase().includes(query))
    },
    tagFilteredNotes() {
      if (this.selectedTags.length === 0) {
        return this.notes
      }
      return this.notes.filter(note => 
        note.tags && note.tags.some(tag => 
          this.selectedTags.some(selectedTag => 
            tag.toLowerCase() === selectedTag.toLowerCase()
          )
        )
      )
    },
    notesTree() {
      // Construir estructura jerárquica de árbol
      const root = []
      const folderMap = {}
      
      // Use tag-filtered notes
      const notesToProcess = this.tagFilteredNotes
      
      // Primero, crear todas las carpetas basadas en los paths de las notas
      notesToProcess.forEach(note => {
        // Use note.id which has the path without .md extension
        const parts = note.id.split('/')
        
        // Crear carpetas intermedias (todas menos la última parte que es el archivo)
        for (let i = 0; i < parts.length - 1; i++) {
          const folderPath = parts.slice(0, i + 1).join('/')
          
          if (!folderMap[folderPath]) {
            const folder = {
              path: folderPath,
              name: parts[i],
              isFolder: true,
              expanded: this.expandedFolders.has(folderPath),
              children: [],
              notes: [],
              folderNote: null // Will store the note that matches folder name
            }
            folderMap[folderPath] = folder
            
            // Agregar a su padre o a la raíz
            if (i === 0) {
              root.push(folder)
            } else {
              const parentPath = parts.slice(0, i).join('/')
              if (folderMap[parentPath]) {
                folderMap[parentPath].children.push(folder)
              }
            }
          }
        }
      })
      
      // Segundo paso: asignar notas a carpetas y detectar folder notes
      notesToProcess.forEach(note => {
        const parts = note.id.split('/')
        const noteName = parts[parts.length - 1]
        
        // Check if this note's path matches an existing folder path
        // This handles cases like: Factions/Drunaris.md and Factions/Drunaris/ folder
        if (folderMap[note.id]) {
          // This note represents a folder!
          folderMap[note.id].folderNote = note
        } else {
          // Regular note - add to parent folder
          const parentPath = parts.slice(0, -1).join('/')
          if (parentPath && folderMap[parentPath]) {
            // Check if this note's name matches the parent folder's name
            const parentFolderName = parts[parts.length - 2]
            if (noteName === parentFolderName) {
              // This note represents the parent folder itself
              folderMap[parentPath].folderNote = note
            } else {
              // Regular note in the folder
              folderMap[parentPath].notes.push(note)
            }
          } else {
            // Nota en la raíz
            root.push({
              ...note,
              isFolder: false
            })
          }
        }
      })
      
      return root
    },
    filteredNotesTree() {
      if (!this.searchQuery) {
        return this.notesTree
      }
      
      const query = this.searchQuery.toLowerCase()
      
      // Filtrar recursivamente
      const filterTree = (items) => {
        return items.map(item => {
          if (item.isFolder) {
            const filteredChildren = filterTree(item.children || [])
            const filteredNotes = item.notes.filter(note => 
              note.title.toLowerCase().includes(query) ||
              note.path.toLowerCase().includes(query)
            )
            
            // Incluir carpeta si tiene notas o hijos que coinciden
            if (filteredNotes.length > 0 || filteredChildren.length > 0) {
              return {
                ...item,
                children: filteredChildren,
                notes: filteredNotes,
                expanded: true // Expandir automáticamente al buscar
              }
            }
            return null
          } else {
            // Es una nota en la raíz
            if (item.title.toLowerCase().includes(query) ||
                item.path.toLowerCase().includes(query)) {
              return item
            }
            return null
          }
        }).filter(item => item !== null)
      }
      
      return filterTree(this.notesTree)
    }
  },
  methods: {
    async fetchNotes() {
      try {
        const response = await axios.get(`${this.apiUrl}/api/notes`)
        this.notes = response.data
        this.loading = false
      } catch (err) {
        this.error = err.message
        this.loading = false
      }
    },
    async fetchTags() {
      try {
        const response = await axios.get(`${this.apiUrl}/api/tags`)
        this.availableTags = response.data
      } catch (err) {
        console.error('Error fetching tags:', err.message)
      }
    },
    toggleTag(tag) {
      const index = this.selectedTags.indexOf(tag)
      if (index === -1) {
        this.selectedTags.push(tag)
      } else {
        this.selectedTags.splice(index, 1)
      }
    },
    clearTags() {
      this.selectedTags = []
      this.tagSearchQuery = ''
    },
    addTagToFilter(tag) {
      // Add tag to filter if not already selected
      if (!this.selectedTags.includes(tag)) {
        this.selectedTags.push(tag)
      }
      // Open the tag filter section to show the active filter
      this.showTagFilter = true
      // Open sidebar on mobile
      this.isOpen = true
    },
    toggleFolder(path) {
      if (this.expandedFolders.has(path)) {
        this.expandedFolders.delete(path)
      } else {
        this.expandedFolders.add(path)
      }
      // Forzar re-render
      this.expandedFolders = new Set(this.expandedFolders)
    },
    toggleSidebar() {
      this.isOpen = !this.isOpen
      document.body.style.overflow = this.isOpen ? 'hidden' : ''
    },
    closeSidebar() {
      this.isOpen = false
      document.body.style.overflow = ''
    }
  },
  mounted() {
    this.fetchNotes()
    this.fetchTags()
  },
  beforeUnmount() {
    document.body.style.overflow = ''
  }
}
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
}

.sidebar-header h2 {
  margin: 0 0 1rem 0;
  font-size: 1.5rem;
  color: var(--text-primary);
}

.search-input {
  width: 100%;
  padding: 0.625rem 0.875rem;
  border: 1px solid var(--border-light);
  border-radius: 8px;
  font-size: 0.9rem;
  background: rgba(26, 27, 58, 0.6);
  color: var(--text-primary);
  transition: all 0.2s ease;
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

/* Tag Filter Styles */
.tag-filter-section {
  margin-top: 0.75rem;
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

.tag-filter-toggle .tag-count + .mdi:last-child {
  margin-left: 0.25rem;
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
  margin-top: 0.75rem;
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

.notes-tree {
  flex: 1;
  overflow-y: auto;
  padding: 0.5rem;
}

.tree-item {
  margin-bottom: 0.25rem;
}

.folder {
  padding: 0.5rem 0.75rem;
  cursor: pointer;
  font-weight: 500;
  border-radius: 6px;
  transition: all 0.15s ease;
  color: var(--text-primary);
  font-size: 0.9rem;
}

.folder:hover {
  background: rgba(138, 92, 245, 0.15);
}

.folder-icon {
  margin-right: 0.5rem;
}

.note-link {
  display: block;
  padding: 0.5rem 0.75rem;
  text-decoration: none;
  color: var(--text-primary);
  border-radius: 6px;
  transition: all 0.15s ease;
  font-size: 0.9rem;
}

.note-link:hover {
  background: rgba(138, 92, 245, 0.15);
}

.note-link.active {
  background: linear-gradient(135deg, rgba(138, 92, 245, 0.4), rgba(99, 102, 241, 0.4));
  color: var(--text-primary);
  font-weight: 500;
  box-shadow: 0 0 12px rgba(138, 92, 245, 0.3);
}

.note-icon {
  margin-right: 0.5rem;
}

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
