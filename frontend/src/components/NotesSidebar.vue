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
        <button class="search-trigger" :aria-keyshortcuts="SEARCH_SHORTCUT_ARIA" @click="isSearchModalOpen = true">
          <span class="mdi mdi-magnify" aria-hidden="true"></span>
          <span class="search-trigger-label">Search</span>
          <kbd class="search-trigger-key" aria-hidden="true">{{ SEARCH_SHORTCUT }}</kbd>
        </button>
        <!-- The Observatory (every document and image) is behind login, like the player. -->
        <div v-if="user" class="observatory-tile">
          <button class="observatory-trigger" @click="openObservatory()">
            <span class="observatory-mark" aria-hidden="true"><span class="mdi mdi-telescope"></span></span>
            <span class="observatory-label">Observatory</span>
            <span class="mdi mdi-chevron-right observatory-go" aria-hidden="true"></span>
          </button>
          <div class="observatory-kinds" role="group" aria-label="Open the Observatory on">
            <button
              v-for="kind in OBSERVATORY_SHORTCUTS"
              :key="kind.type"
              class="observatory-kind"
              :title="`All ${kind.plural}`"
              :aria-label="`All ${kind.plural}`"
              @click="openObservatoryKind(kind.type)"
            >
              <span class="mdi" :class="kind.icon" aria-hidden="true"></span>
            </button>
          </div>
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

          <PlayerTransport compact />

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

    <!-- Each modal is its own chunk, fetched the first time it can open:
         search and the graph when first opened, the rest (all behind login)
         once someone is signed in. -->
    <SearchModal
      v-if="searchUsed"
      ref="searchModalRef"
      :is-open="isSearchModalOpen"
      :notes="notes"
      :available-tags="availableTags"
      @close="isSearchModalOpen = false"
    />
    <GraphModal
      v-if="graphUsed"
      :is-open="isGraphModalOpen"
      @close="closeGraphModal"
    />
    <template v-if="user">
      <PlayerModal
        :is-open="isPlayerModalOpen"
        @close="isPlayerModalOpen = false"
      />
      <ChartsModal :notes="notes" />
      <VistasModal />
      <EncountersModal />
      <BattlemapsModal />
      <CharactersModal />
      <AdversariesModal />
      <ObservatoryModal
        :is-open="isObservatoryOpen"
        :start-path="observatoryPath || ''"
        :start-kind="observatoryKind"
        @close="closeObservatory"
      />
    </template>

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
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick, defineAsyncComponent } from 'vue'
import { useRouter } from 'vue-router'
import TreeItem from './TreeItem.vue'
import PlayerTransport from './PlayerTransport.vue'
import { appVersion } from '../config/env'
import { listenForVaultChanges, useNotes, useNotesChanged } from '@/composables/useNotes'
import { useAuth } from '@/composables/useAuth'
import { useGraphModal } from '@/composables/useGraphModal'
import { useObservatoryModal } from '@/composables/useObservatoryModal'
import { DOC_TYPES } from '@/utils/docTypes'
import { usePlayer } from '@/composables/usePlayer'
import { useCopyToClipboard } from '@/composables/useCopyToClipboard'
import { createScreenLink } from '@/api/screen'
import { noteRoute } from '@/utils/paths'

// Kept out of the main bundle: most readers never open them, and a reader
// who isn't signed in can't open most of them at all.
const SearchModal = defineAsyncComponent(() => import('./SearchModal.vue'))
const GraphModal = defineAsyncComponent(() => import('./GraphModal.vue'))
const PlayerModal = defineAsyncComponent(() => import('./PlayerModal.vue'))
const ChartsModal = defineAsyncComponent(() => import('./ChartsModal.vue'))
const VistasModal = defineAsyncComponent(() => import('./VistasModal.vue'))
const EncountersModal = defineAsyncComponent(() => import('./EncountersModal.vue'))
const BattlemapsModal = defineAsyncComponent(() => import('./BattlemapsModal.vue'))
const CharactersModal = defineAsyncComponent(() => import('./CharactersModal.vue'))
const AdversariesModal = defineAsyncComponent(() => import('./AdversariesModal.vue'))
const ObservatoryModal = defineAsyncComponent(() => import('./ObservatoryModal.vue'))

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
  // (Without a clipboard, copy() hands the link over in a prompt.)
  await copy(link, 'screen-link', 'Screen link. Copy it and open it on the screen device:')
}
const { isOpen: isGraphModalOpen, close: closeGraphModal } = useGraphModal()
const {
  isOpen: isObservatoryOpen, targetId: observatoryPath, kind: observatoryKind,
  open: openObservatory, openKind: openObservatoryKind, close: closeObservatory
} = useObservatoryModal()
// A shortcut per kind of document, in the order the Observatory lists them.
const OBSERVATORY_SHORTCUTS = ['chart', 'vista', 'encounter', 'battlemap', 'character', 'adversary'].map((type) => DOC_TYPES[type])
const {
  isPlaying, currentTrack, volume, setVolume
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
  router.push(`${noteRoute(path)}?new=1`)
}

const {
  notes,
  availableTags,
  loading,
  error,
  hasMore,
  isLoadingMore,
  fetchNotes,
  refreshNotes,
  loadMoreNotes,
  fetchTags
} = useNotes()

// A note saved or created here, or one the server found in the vault (a pull,
// Obsidian), changes the tree and the tags.
let stopListening = null
watch(useNotesChanged(), () => {
  refreshNotes()
  fetchTags()
})

const expandedFolders = ref(new Set())
const isOpen = ref(false)
const isSearchModalOpen = ref(false)
const searchUsed = ref(false)
watch(isSearchModalOpen, (open) => { if (open) searchUsed.value = true })
const graphUsed = ref(false)
watch(isGraphModalOpen, (open) => { if (open) graphUsed.value = true }, { immediate: true })
// Search opens from anywhere with Ctrl+K (Cmd+K on a Mac), as in most apps.
const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
const SEARCH_SHORTCUT = IS_MAC ? '⌘K' : 'Ctrl K'
const SEARCH_SHORTCUT_ARIA = IS_MAC ? 'Meta+K' : 'Control+K'
const onSearchShortcut = (event) => {
  if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    isSearchModalOpen.value = true
  }
}
onMounted(() => window.addEventListener('keydown', onSearchShortcut))
onBeforeUnmount(() => window.removeEventListener('keydown', onSearchShortcut))
const isPlayerModalOpen = ref(false)
const searchModalRef = ref(null)
const scrollIndicator = ref(null)
let scrollObserver = null

// The search modal may still be on its way (its chunk loads on first open):
// the tag waits for it.
let pendingTag = null
const applyPendingTag = () => {
  if (pendingTag === null || !searchModalRef.value) return
  searchModalRef.value.addExternalTag(pendingTag)
  pendingTag = null
}
watch(searchModalRef, applyPendingTag)

const openSearchWithTag = (tag) => {
  pendingTag = tag
  isSearchModalOpen.value = true
  nextTick(applyPendingTag)
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

// While the drawer is open on a phone, the page behind it must not scroll.
// The body never scrolls here (#app is fixed to the viewport): the note
// scrolls in .main-content, so that is what gets locked.
const lockPageScroll = (locked) => {
  const scroller = document.querySelector('.main-content')
  if (scroller) scroller.style.overflowY = locked ? 'hidden' : ''
}

const toggleSidebar = () => {
  isOpen.value = !isOpen.value
  lockPageScroll(isOpen.value)
}

const closeSidebar = () => {
  isOpen.value = false
  lockPageScroll(false)
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

// An IntersectionObserver only reports changes, and the sentinel never
// leaves the view: re-arm it after each page so the next one loads too.
watch([() => notes.value.length, isLoadingMore], () => {
  if (!isLoadingMore.value) setupScrollObserver()
})

onMounted(() => {
  fetchNotes()
  fetchTags()
  setupScrollObserver()
  stopListening = listenForVaultChanges()
})

onBeforeUnmount(() => {
  stopListening?.()
  lockPageScroll(false)
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

/* Search: a field-like control, sunken where the Observatory tile is raised,
   with the same corners so the two read as one block. */
.search-trigger {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  min-height: var(--control-md);
  padding: 0 var(--space-2) 0 var(--space-3);
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-light);
  background: var(--surface-sunken);
  color: var(--text-secondary);
  font-size: var(--text-sm);
  text-align: left;
  transition: border-color var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out);
}

.search-trigger .mdi {
  font-size: 1.15rem;
  color: var(--text-muted);
  transition: color var(--duration-fast) var(--ease-out);
}

.search-trigger-label {
  flex: 1;
}

.search-trigger-key {
  display: inline-flex;
  align-items: center;
  height: 1.375rem;
  padding: 0 0.4rem;
  border: 1px solid var(--border-medium);
  border-bottom-width: 2px;
  border-radius: var(--radius-sm);
  background: var(--surface-raised);
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  line-height: 1;
}

.search-trigger:hover {
  border-color: var(--accent-a45);
  color: var(--text-primary);
}

.search-trigger:hover .mdi {
  color: var(--accent-soft);
}

/* Where every document and image is: a small patch of night sky with the way
   in, and a shortcut to each kind of document under it. */
.observatory-tile {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-2);
  border: 1px solid var(--accent-a30);
  border-radius: var(--radius-lg);
  background:
    radial-gradient(120% 90% at 100% 0%, var(--accent-a20), transparent 62%),
    var(--surface-raised);
}

/* A few fixed stars, top right, behind everything. */
.observatory-tile::before {
  content: '';
  position: absolute;
  top: 10px;
  right: 30%;
  z-index: -1;
  width: 2px;
  height: 2px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.85);
  box-shadow:
    28px 14px 0 0 rgba(255, 255, 255, 0.5),
    46px 4px 0 0 rgba(255, 255, 255, 0.35),
    62px 22px 0 0 rgba(255, 255, 255, 0.7),
    14px 26px 0 -0.5px rgba(255, 255, 255, 0.4),
    -22px 6px 0 -0.5px rgba(255, 255, 255, 0.3);
  pointer-events: none;
}

.observatory-trigger {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  min-height: var(--control-md);
  padding: 0 var(--space-1) 0 2px;
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-primary);
  font-size: var(--text-md, 0.9375rem);
  font-weight: 600;
  text-align: left;
  transition: transform var(--duration-fast) var(--ease-out);
}

.observatory-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border-radius: var(--radius-md);
  background: var(--accent-a30);
  color: #ddd3ff;
  font-size: 1.15rem;
  flex-shrink: 0;
}

.observatory-label {
  flex: 1;
}

.observatory-go {
  color: var(--text-muted);
  font-size: 1.1rem;
  transition: transform var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out);
}

.observatory-trigger:hover .observatory-go {
  color: var(--text-primary);
  transform: translateX(2px);
}

.observatory-trigger:active,
.observatory-kind:active {
  transform: translateY(1px);
}

.observatory-kinds {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: var(--space-1);
}

.observatory-kind {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 1.875rem;
  border: none;
  border-radius: var(--radius-sm);
  background: var(--accent-a12);
  color: var(--accent-soft);
  font-size: 1.05rem;
  transition:
    background-color var(--duration-fast) var(--ease-out),
    color var(--duration-fast) var(--ease-out),
    transform var(--duration-fast) var(--ease-out);
}

.observatory-kind:hover,
.observatory-kind:focus-visible {
  background: var(--accent-a30);
  color: #f1edff;
}

@media (prefers-reduced-motion: reduce) {
  .observatory-trigger:hover .observatory-go {
    transform: none;
  }
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
