<template>
  <div v-if="isOpen" class="rk-scrim" @click.self="closeModal">
    <div class="rk-dialog document-modal" role="dialog" aria-modal="true" :aria-label="kind.title">
      <DocumentModalHeader
        :view="view"
        :icon="kind.icon"
        :gallery-title="kind.title"
        :item-title="activeName"
        :can-edit="canEdit"
        :show-save="saved"
        :has-unsaved-changes="hasUnsavedChanges"
        :saving="saving"
        :show-send-to-screen="!!kind.screen"
        :can-send-to-screen="!!activeDoc?.[kind.imageField]"
        :sending-to-screen="sendingToScreen"
        :live-supported="!!kind.screen"
        :live="live"
        :copy-text="kind.embeddable && activeId ? docRefMarkdown(kind.type, activeId) : null"
        @back="backToGallery"
        @save="saveNow"
        @send-to-screen="sendToScreen"
        @toggle-live="toggleLive(hasUnsavedChanges)"
        @close="closeModal"
      />

      <div class="document-body">
        <div v-if="view === 'gallery'" class="gallery-view">
          <FolderGallery
            :folders="folders"
            :items="items"
            :item-key="(item) => item.id"
            :item-copy-text="kind.embeddable ? (item) => docRefMarkdown(kind.type, item.id) : undefined"
            :current-path="currentPath"
            :loading="loading"
            :error="error"
            :can-edit="canEdit"
            :root-label="kind.title"
            :root-icon="kind.icon"
            :loading-text="`Loading ${kind.plural}...`"
            :empty-icon="kind.emptyIcon"
            :empty-text="kind.emptyText"
            :allow-folders="!kind.keyed"
            @navigate="goToPath"
            @enter-folder="enterFolder"
            @open-item="(item) => openItem(item.id, item.name)"
            @delete-folder="onDeleteFolder"
            @delete-item="onDeleteItem"
            @create-folder="onCreateFolder"
            @rename-folder="onRenameFolder"
            @rename-item="onRenameItem"
            @move="onMove"
          >
            <template v-if="!kind.keyed" #actions>
              <div v-if="showNewInput" class="new-item-form">
                <input
                  ref="newInputRef"
                  v-model="newName"
                  class="rk-input inline-input"
                  :placeholder="`${kind.label} name`"
                  :aria-label="`${kind.label} name`"
                  @keyup.enter="submitNew"
                  @keyup.esc="showNewInput = false"
                />
                <button class="rk-icon-btn" :aria-label="`Create ${kind.label}`" @click="submitNew"><span class="mdi mdi-check"></span></button>
                <button class="rk-icon-btn" aria-label="Cancel" @click="showNewInput = false"><span class="mdi mdi-close"></span></button>
              </div>
              <button v-else class="rk-btn gallery-action-btn" @click="startNew">
                <span class="mdi mdi-plus"></span> New {{ kind.label }}
              </button>
            </template>
            <template #thumb="{ item }">
              <slot name="thumb" :item="item">
                <img v-if="kind.imageField && item[kind.imageField]" :src="resolveUrl(item[kind.imageField])" :alt="item.name" />
                <span v-else class="mdi" :class="kind.thumbIcon || kind.icon"></span>
              </slot>
            </template>
          </FolderGallery>
        </div>

        <div v-else-if="saved" class="editor-view editor-view--canvas">
          <div v-if="loadingDoc" class="loading-state" role="status">
            <span class="rk-spinner rk-spinner--lg"></span>
            <span>Loading {{ kind.label }}...</span>
          </div>
          <slot
            v-else-if="activeDoc"
            name="editor"
            :id="activeId"
            :title="activeName"
            :close="closeModal"
            :doc="activeDoc"
            :markDirty="markDirty"
            :setAsset="setAsset"
          ></slot>
        </div>

        <div v-else class="editor-view">
          <!-- (not `:name`: that would rename the slot itself) -->
          <slot name="editor" :id="activeId" :title="activeName" :close="closeModal" :back="backToGallery"></slot>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import FolderGallery from './FolderGallery.vue'
import DocumentModalHeader from './DocumentModalHeader.vue'
import { useDocCollection } from '@/composables/useDocCollection'
import { useLiveScreen } from '@/composables/useLiveScreen'
import { useUnsavedChangesGuard } from '@/composables/useUnsavedChangesGuard'
import { docRefMarkdown } from '@/utils/inlineRefs'
import { savePayload, screenPayload } from '@/utils/docTypes'
import { resolveUrl } from '@/utils/resolveUrl'

// The modal every kind of document shares: a folder gallery to browse, create,
// rename, move and delete them in, and an editor for the one that is open —
// which is the only part that differs, so it is the `editor` slot. `kind` is
// the kind's entry in utils/docTypes.js (how to word it, what its gallery card
// shows, how it is saved and shown on the screen), `modal` its open/close state
// (useDocModal.js) and `api` its client (api/docs.js).
//
// Two ways of editing, by what the kind says:
// - Live (encounters, battlemaps): the editor owns the document, which the
//   server holds and changes by commands; there is nothing to save. The slot
//   gets { id, title, close }.
// - Saved (charts, vistas: `kind.saved`): this loads the document, the editor
//   changes it in place and calls `markDirty()`, and a Save button sends it
//   whole. The slot gets { doc, markDirty, setAsset, id, title, close }, where
//   setAsset(route, url) sets its picture to a library image. One that is
//   `kind.screen` can also be sent to the table screen, and mirrored there as
//   it is edited.
const props = defineProps({
  kind: { type: Object, required: true },
  modal: { type: Object, required: true },
  api: { type: Object, required: true },
  canEdit: { type: Boolean, default: false }
})

const { folders, items, loading, error, fetchTree, create, remove, move, rename, createFolder, removeFolder, renameFolder, moveFolder } =
  useDocCollection(props.api)

const saved = !!props.kind.saved
const isOpen = computed(() => props.modal.isOpen.value)

const view = ref('gallery')
const currentPath = ref('')
const activeId = ref(null)
const activeName = ref(null)
const activeDoc = ref(null)
const loadingDoc = ref(false)
const hasUnsavedChanges = ref(false)
const saving = ref(false)
const showNewInput = ref(false)
const newName = ref('')
const newInputRef = ref(null)

// What the screen shows is the document as it is right now, saved or not.
const screen = props.kind.screen
  ? useLiveScreen(props.kind.type, activeDoc, (doc) => screenPayload(props.kind, doc))
  : { live: ref(false), sending: ref(false), sendToScreen: () => {}, toggle: () => {}, stop: () => {} }
const { live, sending: sendingToScreen, sendToScreen, toggle: toggleLive, stop: stopLive } = screen

const { confirmDiscard } = useUnsavedChangesGuard(
  hasUnsavedChanges, `You have unsaved changes to this ${props.kind.label}. Discard them?`
)

watch(isOpen, (open) => {
  if (!open) return
  const target = props.modal.targetId.value
  props.modal.targetId.value = null
  if (target) {
    // Opened on one document (a note's embed, a sheet's "Open it"): skip the gallery.
    openItem(target)
  } else if (view.value === 'gallery') {
    currentPath.value = ''
    fetchTree('')
  }
})

function showGallery() {
  view.value = 'gallery'
  activeId.value = null
  activeName.value = null
  activeDoc.value = null
  hasUnsavedChanges.value = false
}

function closeModal() {
  if (!confirmDiscard()) return
  stopLive({ revert: hasUnsavedChanges.value })
  props.modal.close()
  showGallery()
}

async function openItem(id, name = null) {
  activeId.value = id
  activeName.value = name
  view.value = 'editor'
  if (saved) return loadDoc(id)
  if (name) return
  // Opened by id: its name is what the header shows, and the listing has it.
  try {
    const all = await props.api.fetchAll()
    if (activeId.value === id) activeName.value = all.find((item) => item.id === id)?.name || null
  } catch {
    // The editor shows the problem if there is one; the header just has no title.
  }
}

async function loadDoc(id) {
  loadingDoc.value = true
  try {
    const doc = await props.api.fetch(id)
    if (activeId.value !== id) return // moved on while it loaded
    activeDoc.value = doc
    activeName.value = doc.name
    hasUnsavedChanges.value = false
  } catch (err) {
    failure(err)
    showGallery()
  } finally {
    loadingDoc.value = false
  }
}

function backToGallery() {
  if (!confirmDiscard()) return
  stopLive({ revert: hasUnsavedChanges.value })
  showGallery()
  fetchTree(currentPath.value)
}

const markDirty = () => { hasUnsavedChanges.value = true }

async function saveNow() {
  const doc = activeDoc.value
  if (!doc || saving.value) return
  saving.value = true
  try {
    await props.api.save(doc.id, savePayload(props.kind, doc))
    hasUnsavedChanges.value = false
  } catch (err) {
    console.error(`Failed to save ${props.kind.label}:`, err)
  } finally {
    saving.value = false
  }
}

// The picture is set through its own route (which checks it is a library image)
// and at once, not with the rest of the changes on Save.
async function setAsset(route, url) {
  const doc = activeDoc.value
  if (!doc) return
  try {
    const updated = await props.api.setAsset(doc.id, route, url)
    doc[props.kind.imageField] = updated[props.kind.imageField]
  } catch (err) {
    console.error(`Failed to set the ${props.kind.label}'s picture:`, err)
  }
}

const failure = (err) => { error.value = err.response?.data?.detail || err.message }

const folderPath = (folder) => (currentPath.value ? `${currentPath.value}/${folder}` : folder)

function startNew() {
  showNewInput.value = true
  nextTick(() => newInputRef.value?.focus())
}

async function submitNew() {
  const name = newName.value.trim()
  if (!name) return
  newName.value = ''
  showNewInput.value = false
  try {
    const created = await create(name, '', currentPath.value)
    openItem(created.id, created.name)
  } catch (err) {
    failure(err)
  }
}

async function onDeleteItem(item) {
  if (!window.confirm(`Delete ${props.kind.label} "${item.name}"? This cannot be undone.`)) return
  try {
    await remove(currentPath.value, item.id)
  } catch (err) {
    failure(err)
  }
}

async function onRenameItem(item, name) {
  try {
    await rename(currentPath.value, item.id, name)
  } catch (err) {
    failure(err)
  }
}

function enterFolder(folder) {
  currentPath.value = folderPath(folder)
  fetchTree(currentPath.value)
}

function goToPath(path) {
  currentPath.value = path
  fetchTree(path)
}

async function onCreateFolder(name) {
  try {
    await createFolder(currentPath.value, name)
  } catch (err) {
    failure(err)
  }
}

async function onRenameFolder(folder, name) {
  try {
    await renameFolder(currentPath.value, folderPath(folder), name)
  } catch (err) {
    failure(err)
  }
}

async function onDeleteFolder(folder) {
  if (!window.confirm(`Delete folder "${folder}" and everything inside it?`)) return
  try {
    await removeFolder(currentPath.value, folderPath(folder))
  } catch (err) {
    failure(err)
  }
}

async function onMove(dragItem, destPath) {
  try {
    if (dragItem.type === 'folder') {
      const sourcePath = folderPath(dragItem.name)
      if (sourcePath === destPath) return
      await moveFolder(currentPath.value, sourcePath, destPath)
    } else {
      await move(currentPath.value, dragItem.item.id, destPath)
    }
  } catch (err) {
    failure(err)
  }
}
</script>

<style scoped>
/* Shell comes from .rk-scrim / .rk-dialog; only the large-canvas size lives here. */
.document-modal {
  width: min(100%, 1400px);
  height: 90dvh;
}

.document-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.gallery-view {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-6);
}

.new-item-form {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}

.editor-view {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
}

/* A map or a scene fills the space it is given, and does not scroll. */
.editor-view--canvas {
  flex-direction: row;
  overflow: hidden;
}

.loading-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  color: var(--text-secondary);
  font-size: var(--text-sm);
}
</style>
