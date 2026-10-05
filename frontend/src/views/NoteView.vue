<template>
  <div class="note-view-container">
    <div class="note-main-content">
      <div v-if="loading" class="note-content note-loading" aria-busy="true">
        <span class="rk-visually-hidden">Loading note...</span>
        <div class="rk-skeleton skeleton-title"></div>
        <div class="rk-skeleton skeleton-meta"></div>
        <div class="skeleton-body">
          <div class="rk-skeleton skeleton-line"></div>
          <div class="rk-skeleton skeleton-line"></div>
          <div class="rk-skeleton skeleton-line short"></div>
        </div>
      </div>

      <NoteEditor
        v-else-if="editing"
        class="note-content"
        :note-path="notePath"
        :title="note ? note.title : ''"
        :content="editing.content"
        :sha="editing.sha"
        :creating="editing.creating"
        @saved="onSaved"
        @cancel="editing = null"
      />

      <div v-else-if="notFound" class="note-content not-found">
        <span class="mdi mdi-file-question-outline"></span>
        <h2>This note doesn't exist yet</h2>
        <p class="not-found-path">{{ notePath }}</p>
        <button v-if="user" type="button" class="rk-btn rk-btn--primary" @click="startCreating">Create this note</button>
        <p v-else class="not-found-path">Sign in to create it.</p>
      </div>

      <div v-else-if="error" class="note-content note-error">
        <div class="rk-alert" role="alert">
          <span class="mdi mdi-alert-circle-outline"></span>
          <div>
            <strong>Could not load this note.</strong>
            <p>{{ error }}</p>
          </div>
        </div>
      </div>

      <div v-else-if="note" class="note-content">
        <header class="note-header">
          <div class="note-header-top">
            <h1>{{ note.title }}</h1>
            <button
              v-if="user"
              type="button"
              class="rk-icon-btn edit-note-btn"
              title="Edit this note"
              aria-label="Edit this note"
              @click="startEditing"
            >
              <span class="mdi mdi-pencil-outline"></span>
            </button>
          </div>
          <div class="note-meta">
            <nav class="note-breadcrumb" aria-label="Breadcrumb">
              <template v-for="(crumb, index) in breadcrumbs" :key="index">
                <router-link
                  v-if="crumb.to"
                  :to="crumb.to"
                  class="breadcrumb-link"
                >
                  {{ crumb.name }}
                </router-link>
                <span v-else class="breadcrumb-current">{{ crumb.name }}</span>
                <span v-if="index < breadcrumbs.length - 1" class="breadcrumb-separator">/</span>
              </template>
            </nav>
            <div v-if="note.tags && note.tags.length" class="tags">
              <button
                v-for="tag in note.tags"
                :key="tag"
                type="button"
                class="tag clickable"
                @click="addTagFilter(tag)"
                title="Filter by this tag"
              >
                #{{ tag }}
              </button>
            </div>
          </div>
        </header>

        <MarkdownBody
          :html="noteHtml"
          :page-title="note.title"
          @link-hover="prefetchNote($event, 1500)"
          @rendered="scrollToHash"
        />
      </div>
    </div>

    <!-- Not rendered at all where the layout has no room for it (it would
         otherwise fetch the graph and run its simulation hidden). -->
    <RightSidebar
      v-if="hasRoomForAside && note && !loading && !error && !editing"
      :note="note"
      :headings="rendered.headings"
    />
  </div>
</template>

<script setup>
import { computed, inject, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useRoute } from 'vue-router'
import { getCached } from '@/api/http'
import { apiUrl } from '@/config/env'
import { lockAssetImages } from '@/utils/sanitizeHtml'
import { renderNote } from '@/utils/renderNote'
import { noteApi, noteRoute } from '@/utils/noteUrls'
import { useAuth } from '@/composables/useAuth'
import { useMediaQuery } from '@/composables/useMediaQuery'
import { useNoteLoader } from '@/composables/useNoteLoader'
import { useNotesChanged } from '@/composables/useNotes'
import RightSidebar from '@/components/RightSidebar.vue'
import MarkdownBody from '@/components/MarkdownBody.vue'
import NoteEditor from '@/components/NoteEditor.vue'

const props = defineProps({
  notePath: {
    type: String,
    required: true
  }
})

const addTagFilter = inject('addTagFilter', () => {})
const route = useRoute()
const { user } = useAuth()
const { note, loading, error, notFound, load, loadRaw } = useNoteLoader()

// The editor, while open: what it opened with ({ content, sha, creating }).
const editing = shallowRef(null)
const containerFolders = ref({})
// Same breakpoint as the layout's CSS that used to hide it.
const hasRoomForAside = useMediaQuery('(min-width: 1025px)')

const rendered = computed(() => (note.value?.content ? renderNote(note.value.content) : { html: '', headings: [] }))
// Library images are behind login: a signed-out reader gets placeholders.
const noteHtml = computed(() => (user.value ? rendered.value.html : lockAssetImages(rendered.value.html)))

const breadcrumbs = computed(() => {
  if (!note.value || !note.value.id || !containerFolders.value) return []

  const parts = note.value.id.split('/')
  // Start with a link to the root notes view
  const crumbs = [{ name: 'Notes', to: '/' }]

  let currentPath = ''
  for (let i = 0; i < parts.length; i++) {
    const name = parts[i]
    const isLast = i === parts.length - 1

    currentPath = currentPath ? `${currentPath}/${name}` : name

    if (isLast) {
      crumbs.push({ name, to: null })
    } else {
      // If the folder mapping has a note ID for this path, use it as the link
      const targetNoteId = containerFolders.value[currentPath]
      crumbs.push({ name, to: targetNoteId ? noteRoute(targetNoteId) : null })
    }
  }

  return crumbs
})

// The hash of a shared link (#a-heading) is scrolled to once the note is in the page.
let hashScrolledFor = null

async function fetchNote() {
  const path = props.notePath
  editing.value = null
  hashScrolledFor = null
  const loaded = await load(path)
  if (props.notePath !== path) return
  if (loaded) prefetchLinkedNotes(note.value.links || [])
  else openNewNoteEditor()
}

// "New note" lands here with ?new=1: the editor opens on the missing note.
function openNewNoteEditor() {
  if (notFound.value && route.query.new === '1' && user.value && !editing.value) startCreating()
}

async function startEditing() {
  const path = props.notePath
  try {
    const raw = await loadRaw(path)
    // The view moved on to another note before the file came back.
    if (!raw || props.notePath !== path) return
    editing.value = { content: raw.content, sha: raw.sha, creating: false }
  } catch (err) {
    if (props.notePath === path) error.value = err.response?.data?.detail || err.message
  }
}

function startCreating() {
  const title = props.notePath.split('/').pop()
  editing.value = { content: `# ${title}\n\n`, sha: null, creating: true }
}

function onSaved() {
  editing.value = null
  fetchNote()
}

function scrollToHash(el) {
  if (!route.hash || hashScrolledFor === props.notePath) return
  hashScrolledFor = props.notePath
  let id
  try {
    id = decodeURIComponent(route.hash.slice(1))
  } catch {
    return
  }
  el.querySelector(`[id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'start' })
}

// ── Prefetching linked notes ─────────────────────────────────────────
// Keyed by the same URL the view loads a note from, so a prefetched note
// opens straight from the cache.
const prefetched = new Set()
let prefetchTimeout = null

function prefetchNote(id, timeout) {
  if (prefetched.has(id)) return
  prefetched.add(id)
  getCached(noteApi(id), { cacheTtl: 300, timeout }).catch(() => {})
}

function prefetchLinkedNotes(links) {
  if (!links || links.length === 0) return

  const prefetchFn = () => links.slice(0, 5).forEach(id => prefetchNote(id, 2000))

  if (prefetchTimeout) {
    clearTimeout(prefetchTimeout)
  }

  if ('requestIdleCallback' in window) {
    requestIdleCallback(prefetchFn)
  } else {
    prefetchTimeout = setTimeout(prefetchFn, 1000)
  }
}

async function loadContainerFolders() {
  try {
    containerFolders.value = await getCached(`${apiUrl}/api/container-folders`, { cacheTtl: 300 })
  } catch (err) {
    console.error('Error loading container folders:', err)
  }
}

watch(() => props.notePath, fetchNote, { immediate: true })
// The session check can answer after the note did.
watch(user, openNewNoteEditor)
// A note saved here (this one or a new one) can be a folder's note now.
watch(useNotesChanged(), loadContainerFolders)

onMounted(loadContainerFolders)
onBeforeUnmount(() => {
  if (prefetchTimeout) clearTimeout(prefetchTimeout)
})
</script>

<style scoped>
.note-view-container {
  display: flex;
  flex: 1;
  max-width: 1400px;
  margin: 0 auto;
  padding: var(--space-8);
  gap: var(--space-8);
  align-items: flex-start;
}

.note-main-content {
  flex: 1;
  min-width: 0;
}

.note-content {
  background: var(--surface-app);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg);
  padding: var(--space-8);
  box-shadow: var(--shadow-md);
}

/* ── Loading / error ─────────────────────────────────────────── */
.note-loading {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.skeleton-title {
  width: 45%;
  height: 2.25rem;
}

.skeleton-meta {
  width: 30%;
  height: 1rem;
  margin-bottom: var(--space-4);
}

.skeleton-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.skeleton-line {
  height: 0.9rem;
}

.skeleton-line.short {
  width: 60%;
}

.note-error .rk-alert strong {
  display: block;
  margin-bottom: var(--space-1);
}

/* ── Header ──────────────────────────────────────────────────── */
.note-header {
  margin-bottom: var(--space-8);
  padding-bottom: var(--space-4);
  border-bottom: 1px solid var(--border-light);
}

.note-header h1 {
  margin: 0;
  font-size: var(--text-2xl);
  color: var(--text-primary);
}

.note-header-top {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
}

.edit-note-btn {
  color: var(--text-muted);
}

.edit-note-btn:hover:not(:disabled) {
  color: var(--accent-hover);
}

.edit-note-btn .mdi {
  font-size: 1.1rem;
}

/* ── Not found ───────────────────────────────────────────────── */
.not-found {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: var(--space-3);
  max-width: 420px;
  margin: var(--space-12) auto;
  padding: var(--space-10) var(--space-8);
}

.not-found .mdi {
  font-size: 3rem;
  color: var(--text-muted);
}

.not-found h2 {
  margin: 0;
  font-size: var(--text-xl);
  color: var(--text-primary);
}

.not-found-path {
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  color: var(--text-muted);
  margin: 0 0 var(--space-2) 0;
  word-break: break-all;
}

/* ── Meta: breadcrumb + tags ─────────────────────────────────── */
.note-meta {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.note-breadcrumb {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--text-sm);
  color: var(--text-secondary);
}

.breadcrumb-link {
  color: var(--text-secondary);
  text-decoration: none;
  border-radius: var(--radius-sm);
  transition: color var(--duration-fast) var(--ease-out);
}

.breadcrumb-link:hover {
  color: var(--accent-hover);
}

.breadcrumb-separator {
  color: var(--text-muted);
  margin: 0 2px;
}

.breadcrumb-current {
  color: var(--text-primary);
  font-weight: 500;
}

.tags {
  display: flex;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.tag {
  background: var(--accent-a12);
  color: var(--accent-hover);
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-full);
  font-size: var(--text-xs);
  font-weight: 500;
  line-height: 1.4;
  border: 1px solid var(--accent-a30);
}

.tag.clickable {
  transition:
    background-color var(--duration-fast) var(--ease-out),
    border-color var(--duration-fast) var(--ease-out),
    color var(--duration-fast) var(--ease-out),
    transform var(--duration-fast) var(--ease-out);
}

.tag.clickable:hover {
  background: var(--accent-a30);
  border-color: var(--accent);
  color: var(--accent-soft);
}

.tag.clickable:active {
  transform: translateY(1px);
}

.tag.clickable:focus-visible {
  border-radius: var(--radius-full);
}

/* ── Small screens ───────────────────────────────────────────── */
/* Laptop widths: both sidebars are visible, so give the text the room. */
@media (max-width: 1439px) {
  .note-view-container {
    padding: var(--space-6);
    gap: var(--space-6);
  }

  .note-content {
    padding: var(--space-6);
  }
}

@media (max-width: 768px) {
  .note-view-container {
    padding: var(--space-4);
  }

  .note-content {
    padding: var(--space-5);
  }

  .note-header h1 {
    font-size: var(--text-xl);
  }
}
</style>
