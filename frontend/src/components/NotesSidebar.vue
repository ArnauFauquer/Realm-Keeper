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
      :aria-expanded="isOpen"
      aria-controls="notes-sidebar"
      aria-label="Toggle sidebar"
      @click="toggleSidebar"
    >
      <span class="mdi" :class="isOpen ? 'mdi-close' : 'mdi-menu'"></span>
    </button>

    <aside id="notes-sidebar" class="sidebar" :class="{ 'is-open': isOpen }">
      <header class="brand">
        <span class="brand-mark mdi mdi-orbit" aria-hidden="true"></span>
        <span class="brand-name">RealmKeeper</span>
        <span class="brand-version" title="App version">{{ appVersion }}</span>
      </header>

      <nav class="primary-nav" aria-label="Vault tools">
        <button class="search-trigger" @click="isSearchModalOpen = true">
          <span class="mdi mdi-magnify" aria-hidden="true"></span>
          <span>Search Notes</span>
        </button>
        <!-- Charts, vistas and the asset library are behind login, like the player. -->
        <div v-if="user" class="tool-row">
          <button class="tool-btn" @click="openCharts">
            <span class="mdi mdi-map-marker-radius" aria-hidden="true"></span>
            <span>Charts</span>
          </button>
          <button class="tool-btn" @click="openVistas">
            <span class="mdi mdi-image-frame" aria-hidden="true"></span>
            <span>Vistas</span>
          </button>
          <button class="tool-btn" @click="openAssetLibrary">
            <span class="mdi mdi-folder-multiple-image" aria-hidden="true"></span>
            <span>Assets</span>
          </button>
          <button class="tool-btn" @click="openEncounters">
            <span class="mdi mdi-sword-cross" aria-hidden="true"></span>
            <span>Encounters</span>
          </button>
          <button class="tool-btn" @click="openBattlemaps">
            <span class="mdi mdi-grid" aria-hidden="true"></span>
            <span>Battlemaps</span>
          </button>
        </div>
      </nav>

      <div class="tree-header">
        <span class="rk-overline">Notes</span>
        <button
          v-if="user"
          class="rk-icon-btn rk-icon-btn--sm"
          title="New Note"
          aria-label="New Note"
          @click="startNewNote"
        >
          <span class="mdi mdi-plus"></span>
        </button>
      </div>

      <div v-if="loading && notes.length === 0" class="tree-skeleton" aria-busy="true" aria-label="Loading notes">
        <div
          v-for="n in 9"
          :key="n"
          class="rk-skeleton tree-skeleton-row"
          :style="{ width: `${[72, 58, 84, 46, 66, 78, 52, 70, 60][n - 1]}%`, marginLeft: n % 3 === 0 ? '1rem' : '0' }"
        ></div>
      </div>

      <div v-else-if="error" class="tree-state">
        <div class="rk-alert" role="alert">
          <span class="mdi mdi-alert-circle-outline"></span>
          <span>{{ error }}</span>
        </div>
        <button class="rk-btn rk-btn--sm" @click="fetchNotes()">
          <span class="mdi mdi-refresh"></span>
          <span>Retry</span>
        </button>
      </div>

      <div v-else-if="notesTree.length === 0" class="rk-empty">
        <span class="mdi mdi-notebook-outline"></span>
        <p>No notes in this vault yet.</p>
        <button v-if="user" class="rk-btn rk-btn--sm" @click="startNewNote">
          <span class="mdi mdi-plus"></span>
          <span>New Note</span>
        </button>
      </div>

      <div v-else class="notes-tree" ref="treeContainer">
        <TreeItem
          v-for="item in notesTree"
          :key="item.path || item.id"
          :item="item"
          :level="0"
          @toggle="toggleFolder"
          @note-click="closeSidebar"
        />
      </div>

      <!-- Infinite scroll sentinel. It sits outside the scrolling tree on purpose:
           it stays in view, so every page loads up front and search sees all notes. -->
      <div v-if="hasMore && notes.length" class="load-more" ref="scrollIndicator">
        <template v-if="isLoadingMore">
          <span class="rk-spinner"></span>
          <span>Loading more notes</span>
        </template>
      </div>

      <footer class="sidebar-footer">
        <section v-if="user" class="now-playing" aria-label="Music player">
          <div class="now-playing-head">
            <span class="track-icon mdi" :class="isPlaying ? 'mdi-music' : 'mdi-music-note-outline'" aria-hidden="true"></span>
            <span class="track-title" :class="{ 'is-idle': !currentTrack }">
              {{ currentTrack ? currentTrack.name : 'Nothing playing' }}
            </span>
            <button class="rk-btn rk-btn--ghost rk-btn--sm player-open-btn" title="Open player" @click="isPlayerModalOpen = true">
              <span class="mdi mdi-music-box-multiple-outline"></span>
              <span>Player</span>
            </button>
          </div>

          <div class="transport">
            <button
              class="rk-icon-btn rk-icon-btn--sm"
              :class="{ 'is-active': isShuffle }"
              title="Shuffle"
              aria-label="Shuffle"
              :aria-pressed="isShuffle"
              @click="toggleShuffle"
            >
              <span class="mdi mdi-shuffle-variant"></span>
            </button>
            <button class="rk-icon-btn rk-icon-btn--sm" title="Previous" aria-label="Previous track" @click="playPrev">
              <span class="mdi mdi-skip-previous"></span>
            </button>
            <button
              class="play-btn"
              :title="isPlaying ? 'Pause' : 'Play'"
              :aria-label="isPlaying ? 'Pause' : 'Play'"
              @click="togglePlay"
            >
              <span class="mdi" :class="isPlaying ? 'mdi-pause' : 'mdi-play'"></span>
            </button>
            <button class="rk-icon-btn rk-icon-btn--sm" title="Next" aria-label="Next track" @click="playNext">
              <span class="mdi mdi-skip-next"></span>
            </button>
            <button
              class="rk-icon-btn rk-icon-btn--sm"
              :class="{ 'is-active': isRepeat }"
              title="Repeat"
              aria-label="Repeat"
              :aria-pressed="isRepeat"
              @click="toggleRepeat"
            >
              <span class="mdi mdi-repeat"></span>
            </button>
          </div>

          <label class="volume">
            <span class="mdi" :class="volume === 0 ? 'mdi-volume-mute' : 'mdi-volume-high'" aria-hidden="true"></span>
            <span class="rk-visually-hidden">Volume</span>
            <input
              type="range" min="0" max="1" step="0.01"
              :value="volume"
              class="volume-bar"
              @input="setVolume($event.target.valueAsNumber)"
            />
          </label>
        </section>

        <div v-if="user && !user.local" class="account">
          <div class="avatar" aria-hidden="true">{{ userInitial }}</div>
          <span class="account-email" :title="user.email">{{ user.email }}</span>
          <button
            class="rk-icon-btn rk-icon-btn--sm"
            :title="copiedKey === 'screen-link' ? 'Screen link copied' : 'Copy screen link (open it on the TV / projector)'"
            :aria-label="copiedKey === 'screen-link' ? 'Screen link copied' : 'Copy screen link'"
            @click="copyScreenLink"
          >
            <span class="mdi" :class="copiedKey === 'screen-link' ? 'mdi-check' : 'mdi-monitor-share'"></span>
          </button>
          <button class="rk-icon-btn rk-icon-btn--sm rk-btn--danger" title="Sign out" aria-label="Sign out" @click="logout">
            <span class="mdi mdi-logout-variant"></span>
          </button>
        </div>
        <button v-else-if="!user" class="rk-btn rk-btn--block" @click="login">
          <span class="mdi mdi-login-variant"></span>
          <span>Sign in</span>
        </button>
      </footer>
    </aside>

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
    <VistasModal />
    <EncountersModal />
    <BattlemapsModal />
    <AssetLibraryModal :is-open="isAssetLibraryOpen" @close="closeAssetLibrary" />

    <div v-if="showNewNoteInput" class="rk-scrim" @click.self="showNewNoteInput = false">
      <div class="rk-dialog" role="dialog" aria-modal="true" aria-labelledby="new-note-title">
        <div class="rk-dialog__header">
          <h2 id="new-note-title" class="rk-dialog__title">
            <span class="mdi mdi-note-plus-outline"></span> New Note
          </h2>
          <button class="rk-icon-btn" aria-label="Close" @click="showNewNoteInput = false">
            <span class="mdi mdi-close"></span>
          </button>
        </div>
        <div class="rk-dialog__body">
          <div class="rk-field">
            <label class="rk-label" for="new-note-path">Note path</label>
            <input
              id="new-note-path"
              ref="newNoteInputRef"
              v-model="newNotePath"
              class="rk-input"
              placeholder="Oneshots/My New Adventure"
              aria-describedby="new-note-hint"
              @keyup.enter="submitNewNote"
              @keyup.esc="showNewNoteInput = false"
            />
            <p id="new-note-hint" class="rk-hint">Use <code class="rk-code">/</code> to place it inside a folder.</p>
          </div>
        </div>
        <div class="rk-dialog__actions">
          <button class="rk-btn rk-btn--ghost" @click="showNewNoteInput = false">Cancel</button>
          <button class="rk-btn rk-btn--primary" :disabled="!newNotePath.trim()" @click="submitNewNote">Create Note</button>
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
import VistasModal from './VistasModal.vue'
import EncountersModal from './EncountersModal.vue'
import BattlemapsModal from './BattlemapsModal.vue'
import AssetLibraryModal from './AssetLibraryModal.vue'
import { appVersion } from '../config/env'
import { useNotes } from '@/composables/useNotes'
import { useAuth } from '@/composables/useAuth'
import { useGraphModal } from '@/composables/useGraphModal'
import { useDocModal } from '@/composables/useDocModal'
import { useAssetLibraryModal } from '@/composables/useAssetLibraryModal'
import { usePlayer } from '@/composables/usePlayer'
import { useCopyToClipboard } from '@/composables/useCopyToClipboard'
import { createScreenLink } from '@/api/screen'

const router = useRouter()
const { user, login, logout } = useAuth()
const { copiedKey, copy } = useCopyToClipboard()

// Screens (TV, projector, OBS) don't sign in: they're paired by opening this
// link once, and then only ever receive what's sent to the screen.
async function copyScreenLink() {
  let link
  try {
    link = await createScreenLink()
  } catch (err) {
    console.error('Failed to create screen link:', err)
    return
  }
  // No clipboard (plain-HTTP LAN, or Safari after the awaited request):
  // hand the link over for a manual copy rather than silently doing nothing.
  if (!(await copy(link, 'screen-link'))) window.prompt('Screen link. Copy it and open it on the screen device:', link)
}
const { isOpen: isGraphModalOpen, close: closeGraphModal } = useGraphModal()
const { open: openCharts } = useDocModal('chart')
const { open: openVistas } = useDocModal('vista')
const { open: openEncounters } = useDocModal('encounter')
const { open: openBattlemaps } = useDocModal('battlemap')
const { isOpen: isAssetLibraryOpen, open: openAssetLibrary, close: closeAssetLibrary } = useAssetLibraryModal()
const {
  isPlaying, isRepeat, isShuffle, currentTrack, volume,
  togglePlay, playNext, playPrev, toggleRepeat, toggleShuffle, setVolume
} = usePlayer()

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
  width: var(--sidebar-width);
  height: 100%;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--surface-chrome);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-right: 1px solid var(--border-light);
}

/* ── Brand ─────────────────────────────────────────────────────── */
.brand {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-5) var(--space-5) var(--space-4);
}

.brand-mark {
  font-size: 1.9rem;
  line-height: 1;
  background: var(--brand-gradient);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}

.brand-name {
  font-family: var(--font-display);
  font-size: 1.6rem;
  font-weight: 600;
  letter-spacing: -0.015em;
  line-height: 1;
  background: var(--brand-gradient);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}

.brand-version {
  margin-left: auto;
  align-self: flex-end;
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  color: var(--text-muted);
}

/* ── Primary nav ───────────────────────────────────────────────── */
.primary-nav {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: 0 var(--space-4) var(--space-4);
  border-bottom: 1px solid var(--border-light);
}

.search-trigger {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  min-height: var(--control-md);
  padding: 0 var(--space-3);
  border-radius: var(--radius-md);
  border: 1px solid var(--border-light);
  background: var(--surface-sunken);
  color: var(--text-secondary);
  font-size: var(--text-sm);
  text-align: left;
  transition: border-color var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out);
}

.search-trigger .mdi {
  font-size: 1.1rem;
}

.search-trigger:hover {
  border-color: var(--border-medium);
  color: var(--text-primary);
}

.tool-row {
  display: grid;
  /* As many tools as fit a row, however many there are. */
  grid-template-columns: repeat(auto-fit, minmax(4.75rem, 1fr));
  gap: var(--space-1);
}

.tool-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: var(--space-2) var(--space-1);
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--text-xs);
  font-weight: 500;
  transition:
    background-color var(--duration-fast) var(--ease-out),
    color var(--duration-fast) var(--ease-out),
    transform var(--duration-fast) var(--ease-out);
}

.tool-btn .mdi {
  font-size: 1.3rem;
  line-height: 1.2;
  color: var(--text-muted);
  transition: color var(--duration-fast) var(--ease-out);
}

.tool-btn:hover {
  background: var(--hover-tint);
  color: var(--text-primary);
}

.tool-btn:hover .mdi {
  color: var(--accent-hover);
}

.tool-btn:active {
  transform: translateY(1px);
}

/* ── Tree ──────────────────────────────────────────────────────── */
.tree-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-3) var(--space-3) var(--space-1) var(--space-5);
  min-height: 40px;
}

.notes-tree {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 var(--space-3) var(--space-3);
}

.tree-skeleton {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-5);
}

.tree-skeleton-row {
  height: 14px;
}

.tree-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-4);
}

.load-more {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  min-height: 48px;
  color: var(--text-muted);
  font-size: var(--text-xs);
}

/* ── Footer: player + account ──────────────────────────────────── */
.sidebar-footer {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-3);
  border-top: 1px solid var(--border-light);
}

.now-playing {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  border-radius: var(--radius-lg);
  background: var(--surface-raised);
  border: 1px solid var(--border-light);
}

.now-playing-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.player-open-btn {
  flex-shrink: 0;
  margin-right: calc(-1 * var(--space-1));
  padding: 0 var(--space-2);
}

.track-icon {
  flex-shrink: 0;
  font-size: 1rem;
  color: var(--accent-hover);
}

.track-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--text-primary);
}

.track-title.is-idle {
  font-weight: 400;
  color: var(--text-muted);
}

.transport {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.play-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--control-md);
  height: var(--control-md);
  border: none;
  border-radius: var(--radius-full);
  background: var(--accent-strong);
  color: var(--accent-contrast);
  box-shadow: var(--shadow-accent);
  transition: background-color var(--duration-fast) var(--ease-out), transform var(--duration-fast) var(--ease-out);
}

.play-btn .mdi {
  font-size: 1.3rem;
}

.play-btn:hover {
  background: var(--accent-strong-hover);
}

.play-btn:active {
  transform: scale(0.94);
}

.volume {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--text-muted);
}

.volume .mdi {
  flex-shrink: 0;
  font-size: 0.95rem;
}

.volume-bar {
  flex: 1;
  min-width: 0;
  accent-color: var(--accent);
}

.account {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 0 var(--space-1);
}

.avatar {
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-full);
  font-size: var(--text-xs);
  font-weight: 700;
  color: var(--bg-primary);
  background: var(--brand-gradient-diagonal);
}

.account-email {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-xs);
  color: var(--text-secondary);
}

/* ── Mobile drawer ─────────────────────────────────────────────── */
.sidebar-toggle {
  display: none;
  position: fixed;
  left: var(--space-4);
  bottom: calc(var(--space-4) + env(safe-area-inset-bottom, 0px));
  z-index: var(--z-drawer-toggle);
  width: 52px;
  height: 52px;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-full);
  background: var(--accent-strong);
  color: var(--accent-contrast);
  box-shadow: var(--shadow-md), var(--shadow-accent);
  transition: background-color var(--duration-base) var(--ease-out), transform var(--duration-fast) var(--ease-out);
}

.sidebar-toggle .mdi {
  font-size: 1.5rem;
}

.sidebar-toggle:active {
  transform: scale(0.95);
}

.sidebar-toggle.is-open {
  background: var(--bg-elevated);
}

.sidebar-overlay {
  display: none;
  position: fixed;
  inset: 0;
  z-index: calc(var(--z-drawer) - 1);
  background: var(--scrim);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}

@media (max-width: 768px) {
  .sidebar-toggle {
    display: flex;
  }

  .sidebar-overlay {
    display: block;
  }

  .sidebar {
    position: fixed;
    top: 0;
    left: 0;
    z-index: var(--z-drawer);
    width: min(86vw, 320px);
    /* Leave the bottom strip free for the floating toggle. */
    height: calc(100dvh - var(--mobile-bar-height) - env(safe-area-inset-bottom, 0px));
    border-bottom-right-radius: var(--radius-lg);
    transform: translateX(-100%);
    transition: transform var(--duration-slow) var(--ease-out);
    box-shadow: var(--shadow-lg);
  }

  .sidebar.is-open {
    transform: translateX(0);
  }
}
</style>
