<template>
  <div v-if="isOpen" class="rk-scrim" :class="{ 'picker-scrim': pickerMode }" @click.self="close">
    <div class="rk-dialog observatory-modal" role="dialog" aria-modal="true" :aria-label="title">
      <DocumentModalHeader
        :view="view === 'viewer' ? 'editor' : 'gallery'"
        icon="mdi-telescope"
        :gallery-title="title"
        :item-title="activeImage?.name"
        :can-edit="canEdit"
        :show-save="false"
        :can-send-to-screen="!!activeImage"
        :sending-to-screen="sendingToScreen"
        :copy-text="activeImage ? imageMarkdown(activeImage) : null"
        @back="backToGallery"
        @send-to-screen="sendToScreen"
        @close="close"
      />

      <div v-if="view === 'gallery'" class="observatory-body">
        <FolderGallery
          :folders="folders"
          :items="shownItems"
          :item-key="itemKey"
          :item-copy-text="copyText"
          :current-path="currentPath"
          :loading="loading"
          :error="error"
          :can-edit="canEdit"
          root-label="Observatory"
          root-icon="mdi-telescope"
          loading-text="Loading the Observatory..."
          empty-icon="mdi-star-four-points-outline"
          :empty-text="emptyText"
          @navigate="goToPath"
          @enter-folder="enterFolder"
          @open-item="openItem"
          @delete-folder="onDeleteFolder"
          @delete-item="onDeleteItem"
          @create-folder="onCreateFolder"
          @rename-folder="onRenameFolder"
          @rename-item="onRenameItem"
          @move="onMove"
        >
          <template #actions>
            <div v-if="newKind" class="new-item-form">
              <input
                ref="newInputRef"
                v-model="newName"
                class="rk-input inline-input"
                :placeholder="`${newKind.label} name`"
                :aria-label="`${newKind.label} name`"
                @keyup.enter="submitNew"
                @keyup.esc="newKind = null"
              />
              <button class="rk-icon-btn" :aria-label="`Create ${newKind.label}`" @click="submitNew"><span class="mdi mdi-check"></span></button>
              <button class="rk-icon-btn" aria-label="Cancel" @click="newKind = null"><span class="mdi mdi-close"></span></button>
            </div>
            <div v-else-if="!pickerMode" ref="newMenuRef" class="new-menu">
              <button class="rk-btn gallery-action-btn" :aria-expanded="newMenuOpen" aria-haspopup="menu" @click="newMenuOpen = !newMenuOpen">
                <span class="mdi mdi-plus"></span> New <span class="mdi mdi-menu-down" aria-hidden="true"></span>
              </button>
              <div v-if="newMenuOpen" class="new-menu-list" role="menu">
                <button v-for="kind in DOC_KINDS" :key="kind.type" class="new-menu-item" role="menuitem" @click="startNew(kind)">
                  <span class="mdi" :class="kind.icon" aria-hidden="true"></span> {{ capitalize(kind.label) }}
                </button>
              </div>
            </div>
            <label class="rk-btn gallery-action-btn" :class="{ busy: uploading }">
              <span v-if="uploading" class="rk-spinner" aria-hidden="true"></span>
              <span v-else class="mdi mdi-upload"></span>
              <span>{{ uploading ? 'Uploading...' : 'Upload images' }}</span>
              <input type="file" accept="image/*" multiple hidden :disabled="uploading" @change="onImagesSelected" />
            </label>
            <template v-if="!pickerMode">
              <span class="actions-spacer" aria-hidden="true"></span>
              <a
                class="rk-btn gallery-action-btn"
                :href="observatoryApi.exportUrl(currentPath)"
                download
                :title="currentPath ? `Download “${currentPath}” as a zip backup` : 'Download everything as a zip backup'"
              >
                <span class="mdi mdi-download"></span> Export
              </a>
              <label class="rk-btn gallery-action-btn" :class="{ busy: restoring }" title="Put a backup back where it was. Nothing already here is replaced.">
                <span v-if="restoring" class="rk-spinner" aria-hidden="true"></span>
                <span v-else class="mdi mdi-backup-restore"></span>
                <span>{{ restoring ? 'Restoring...' : 'Restore' }}</span>
                <input type="file" accept=".zip,application/zip" hidden :disabled="restoring" @change="onBackupSelected" />
              </label>
            </template>
          </template>

          <template #filters>
            <div v-if="restoreReport" class="rk-alert restore-report" role="status">
              <span class="mdi mdi-backup-restore"></span>
              <div>
                <p>Restored {{ restoreReport.restored }} file{{ restoreReport.restored === 1 ? '' : 's' }}<template v-if="restoreReport.skipped.length">; {{ restoreReport.skipped.length }} left out</template>.</p>
                <details v-if="restoreReport.skipped.length">
                  <summary>What was left out</summary>
                  <ul>
                    <li v-for="skip in restoreReport.skipped" :key="skip.path"><code>{{ skip.path }}</code>: {{ skip.reason }}</li>
                  </ul>
                </details>
              </div>
              <button class="rk-icon-btn rk-icon-btn--sm" aria-label="Dismiss" @click="restoreReport = null"><span class="mdi mdi-close"></span></button>
            </div>
            <div v-if="!pickerMode && presentKinds.length > 1" class="kind-filter" role="group" aria-label="Show">
              <button class="kind-chip" :class="{ active: !filter }" :aria-pressed="!filter" @click="filter = null">All</button>
              <button
                v-for="kind in presentKinds"
                :key="kind.type"
                class="kind-chip"
                :class="{ active: filter === kind.type }"
                :aria-pressed="filter === kind.type"
                @click="filter = filter === kind.type ? null : kind.type"
              >
                <span class="mdi" :class="kind.icon" aria-hidden="true"></span> {{ kind.title }}
              </button>
            </div>
          </template>

          <template #thumb="{ item }">
            <template v-if="thumbUrl(item)">
              <img :src="resolveUrl(thumbUrl(item))" :alt="item.name" />
              <!-- On a picture, what kind of document it is goes in the corner. -->
              <span v-if="item.kind !== 'image'" class="kind-badge" :title="capitalize(kindOf(item).label)">
                <span class="mdi" :class="kindOf(item).icon" aria-hidden="true"></span>
                <span class="rk-visually-hidden">{{ kindOf(item).label }}</span>
              </span>
            </template>
            <span v-else class="mdi" :class="kindOf(item).icon" :title="capitalize(kindOf(item).label)"></span>
          </template>
        </FolderGallery>
      </div>

      <div v-else class="viewer-view">
        <img v-if="activeImage" :src="resolveUrl(activeImage.url)" :alt="activeImage.name" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import FolderGallery from './FolderGallery.vue'
import DocumentModalHeader from './DocumentModalHeader.vue'
import { docApi } from '@/api/docs'
import { observatoryApi } from '@/api/observatory'
import { post } from '@/api/http'
import { apiUrl } from '@/config/env'
import { useAuth } from '@/composables/useAuth'
import { useDocModal } from '@/composables/useDocModal'
import { DOC_TYPES, IMAGE_KIND } from '@/utils/docTypes'
import { docRefMarkdown } from '@/utils/inlineRefs'
import { absoluteUrl, resolveUrl } from '@/utils/resolveUrl'

// The Observatory: every document (charts, vistas, encounters, battlemaps,
// characters, adversaries) and every image, in one tree of folders, so an
// adventure's map, its chart and its encounters can live together. Opening a
// document hands it to its kind's editor (DocumentModal), whose Back comes
// here again; an image opens in a viewer that can send it to the screen.
//
// As a picker (`pickerMode`, from an editor choosing a map or an icon) it shows
// only folders and images, and picking one emits `select` with { name, image_url }.
const props = defineProps({
  isOpen: { type: Boolean, default: false },
  pickerMode: { type: Boolean, default: false },
  // The folder it opens at: a picker opens beside the document being edited.
  startPath: { type: String, default: '' }
})

const emit = defineEmits(['close', 'select'])

const DOC_KINDS = Object.values(DOC_TYPES)
const KINDS = [...DOC_KINDS, IMAGE_KIND]

const { user } = useAuth()
const canEdit = computed(() => !!user.value)
const title = computed(() => (props.pickerMode ? 'Choose an image' : 'Observatory'))

const folders = ref([])
const items = ref([])
const loading = ref(false)
const error = ref(null)
const currentPath = ref('')
const filter = ref(null)
const view = ref('gallery')
const activeImage = ref(null)
const sendingToScreen = ref(false)
const uploading = ref(false)
const restoring = ref(false)
const restoreReport = ref(null)
const newMenuOpen = ref(false)
const newMenuRef = ref(null)
const newKind = ref(null)
const newName = ref('')
const newInputRef = ref(null)

const kindOf = (item) => (item.kind === 'image' ? IMAGE_KIND : DOC_TYPES[item.kind])
const itemKey = (item) => `${item.kind}:${item.id}`
const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1)

const presentKinds = computed(() => KINDS.filter((kind) => items.value.some((item) => item.kind === kind.type)))
const shownItems = computed(() => {
  const only = props.pickerMode ? 'image' : filter.value
  return only ? items.value.filter((item) => item.kind === only) : items.value
})
const emptyText = computed(() => {
  if (props.pickerMode) return 'No images here. Upload one, or look in another folder.'
  if (filter.value && items.value.length) return `No ${kindOf({ kind: filter.value }).plural} in this folder.`
  return 'Nothing here yet. Create a document, upload images or add a folder.'
})

function thumbUrl(item) {
  if (item.kind === 'image') return item.url
  const field = DOC_TYPES[item.kind]?.imageField
  return field ? item[field] : null
}

// CommonMark link destinations can't hold a bare space: the URL comes quoted.
const imageMarkdown = (image) => `![${image.name.replace(/\.[^.]+$/, '')}](${absoluteUrl(image.url)})`

function copyText(item) {
  if (item.kind === 'image') return imageMarkdown(item)
  return DOC_TYPES[item.kind]?.embeddable ? docRefMarkdown(item.kind, item.id) : null
}

watch(() => props.isOpen, (open) => {
  if (!open) return
  view.value = 'gallery'
  activeImage.value = null
  filter.value = null
  restoreReport.value = null
  goToPath(props.startPath || '')
}, { immediate: true })

async function fetchLevel(path = currentPath.value) {
  loading.value = true
  error.value = null
  try {
    const listing = await observatoryApi.list(path)
    if (path !== currentPath.value) return // moved on while it loaded
    folders.value = listing.folders
    items.value = listing.items
  } catch (err) {
    // A folder that is gone (moved by someone else): show the top instead.
    if (err.response?.status === 404 && path) return goToPath('')
    failure(err)
  } finally {
    loading.value = false
  }
}

const failure = (err) => { error.value = err.response?.data?.detail || err.message }
const folderPath = (folder) => (currentPath.value ? `${currentPath.value}/${folder}` : folder)

// Each change happens in the level on screen, then shows it again.
async function changing(change) {
  try {
    await change()
  } catch (err) {
    failure(err)
    return
  }
  await fetchLevel()
}

function goToPath(path) {
  currentPath.value = path
  filter.value = null
  fetchLevel(path)
}

function enterFolder(folder) {
  goToPath(folderPath(folder))
}

function close() {
  newMenuOpen.value = false
  newKind.value = null
  emit('close')
}

function openItem(item) {
  if (item.kind === 'image') {
    if (props.pickerMode) {
      emit('select', { name: item.name.replace(/\.[^.]+$/, ''), image_url: item.url })
      return
    }
    activeImage.value = item
    view.value = 'viewer'
    return
  }
  close()
  useDocModal(item.kind).open(item.id)
}

function backToGallery() {
  view.value = 'gallery'
  activeImage.value = null
}

async function sendToScreen() {
  if (!activeImage.value) return
  try {
    await post(`${apiUrl}/api/screen/display`, { url: resolveUrl(activeImage.value.url), title: activeImage.value.name })
    sendingToScreen.value = true
    setTimeout(() => { sendingToScreen.value = false }, 2000)
  } catch (err) {
    console.error('Failed to send the image to the screen:', err)
  }
}

// ── making things ───────────────────────────────────────────────────────

function startNew(kind) {
  newMenuOpen.value = false
  newKind.value = kind
  newName.value = ''
  nextTick(() => newInputRef.value?.focus())
}

async function submitNew() {
  const kind = newKind.value
  const name = newName.value.trim()
  if (!kind || !name) return
  newKind.value = null
  try {
    const created = await docApi(kind.type).create(name, '', currentPath.value)
    close()
    useDocModal(kind.type).open(created.id)
  } catch (err) {
    failure(err)
  }
}

function onOutsideClick(event) {
  if (newMenuOpen.value && !newMenuRef.value?.contains(event.target)) newMenuOpen.value = false
}
document.addEventListener('click', onOutsideClick, true)
onBeforeUnmount(() => document.removeEventListener('click', onOutsideClick, true))

// Uploads one at a time, so a slow or failing one doesn't race the others.
async function onImagesSelected(event) {
  const files = Array.from(event.target.files)
  event.target.value = ''
  if (!files.length) return
  uploading.value = true
  try {
    const uploaded = []
    for (const file of files) uploaded.push(await observatoryApi.uploadImage(currentPath.value, file))
    if (props.pickerMode && uploaded.length === 1) openItem(uploaded[0])
    else await fetchLevel()
  } catch (err) {
    failure(err)
  } finally {
    uploading.value = false
  }
}

async function onBackupSelected(event) {
  const [file] = event.target.files
  event.target.value = ''
  if (!file) return
  if (!window.confirm(`Restore “${file.name}”? What it holds goes back where it was; nothing already in the Observatory is replaced.`)) return
  restoring.value = true
  try {
    restoreReport.value = await observatoryApi.importBackup(file)
    await fetchLevel()
  } catch (err) {
    failure(err)
  } finally {
    restoring.value = false
  }
}

// ── changing things ─────────────────────────────────────────────────────

function onDeleteItem(item) {
  const what = item.kind === 'image' ? 'image' : DOC_TYPES[item.kind].label
  if (!window.confirm(`Delete ${what} "${item.name}"? This cannot be undone.`)) return
  changing(() => (item.kind === 'image' ? observatoryApi.removeImage(item.id) : docApi(item.kind).remove(item.id)))
}

function onRenameItem(item, name) {
  changing(() => (item.kind === 'image' ? observatoryApi.renameImage(item.id, name) : docApi(item.kind).rename(item.id, name)))
}

function onCreateFolder(name) {
  changing(() => observatoryApi.createFolder(folderPath(name)))
}

function onRenameFolder(folder, name) {
  changing(() => observatoryApi.renameFolder(folderPath(folder), name))
}

function onDeleteFolder(folder) {
  if (!window.confirm(`Delete folder "${folder}" and everything inside it: documents and images?`)) return
  changing(() => observatoryApi.removeFolder(folderPath(folder)))
}

function onMove(dragItem, destPath) {
  if (dragItem.type === 'folder') {
    const sourcePath = folderPath(dragItem.name)
    if (sourcePath === destPath) return
    changing(() => observatoryApi.moveFolder(sourcePath, destPath))
    return
  }
  const { item } = dragItem
  changing(() => (item.kind === 'image' ? observatoryApi.moveImage(item.id, destPath) : docApi(item.kind).move(item.id, destPath)))
}
</script>

<style scoped>
/* As a picker it opens on top of a document's editor, so it sits one layer up. */
.picker-scrim {
  z-index: var(--z-modal-nested);
}

.observatory-modal {
  width: min(100%, 1400px);
  height: 90dvh;
}

.observatory-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--space-6);
}

.new-item-form {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}

.actions-spacer {
  flex: 1;
}

@media (max-width: 640px) {
  .actions-spacer {
    display: none;
  }
}

.new-menu {
  position: relative;
}

.new-menu-list {
  position: absolute;
  top: calc(100% + var(--space-1));
  left: 0;
  z-index: 5;
  min-width: 12rem;
  display: flex;
  flex-direction: column;
  padding: var(--space-1);
  background: var(--surface-overlay);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
}

.new-menu-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--control-sm);
  padding: 0 var(--space-3);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-size: var(--text-sm);
  text-align: left;
}

.new-menu-item:hover,
.new-menu-item:focus-visible {
  background: var(--hover-tint);
}

.kind-filter {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.kind-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  min-height: var(--control-sm);
  padding: 0 var(--space-3);
  background: transparent;
  border: 1px solid var(--border-light);
  border-radius: 999px;
  color: var(--text-secondary);
  font-size: var(--text-sm);
}

.kind-chip:hover {
  background: var(--hover-tint);
  color: var(--text-primary);
}

.kind-chip.active {
  background: var(--accent-strong);
  border-color: var(--accent-strong);
  color: var(--accent-contrast);
}

/* What kind a document is, in the corner of its card. */
.kind-badge {
  position: absolute;
  left: var(--space-2);
  bottom: var(--space-2);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.75rem;
  height: 1.75rem;
  border-radius: var(--radius-sm);
  background: var(--surface-overlay);
  color: var(--text-primary);
  font-size: 1rem;
  pointer-events: none;
}

.restore-report {
  align-items: flex-start;
}

.restore-report > div {
  flex: 1;
}

.restore-report p {
  margin: 0;
}

.restore-report ul {
  margin: var(--space-2) 0 0;
  padding-left: var(--space-5);
  font-size: var(--text-sm);
}

a.gallery-action-btn {
  text-decoration: none;
}

.busy {
  pointer-events: none;
  opacity: 0.6;
}

.gallery-action-btn .rk-spinner {
  width: 14px;
  height: 14px;
}

.viewer-view {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-6);
}

.viewer-view img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: var(--radius-md);
}
</style>
