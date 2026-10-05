<template>
  <div
    class="folder-gallery"
    :class="{ 'files-over': filesOver }"
    ref="galleryRef"
    @dragover="onGalleryDragOver"
    @dragleave="onGalleryDragLeave"
    @drop="onGalleryDrop"
  >
    <nav class="breadcrumb" aria-label="Folder path">
      <button
        class="breadcrumb-item"
        :class="{ current: currentPath === '', 'drag-over': dragOverTarget === '' }"
        @click="$emit('navigate', '')"
        @dragover.prevent="dragOver('')"
        @dragleave="dragLeave('')"
        @drop.prevent.stop="onDrop('', $event)"
      >
        <span class="mdi" :class="rootIcon"></span> {{ rootLabel }}
      </button>
      <template v-for="crumb in breadcrumb" :key="crumb.path">
        <span class="breadcrumb-sep mdi mdi-chevron-right" aria-hidden="true"></span>
        <button
          class="breadcrumb-item"
          :class="{ current: crumb.path === currentPath, 'drag-over': dragOverTarget === crumb.path }"
          @click="$emit('navigate', crumb.path)"
          @dragover.prevent="dragOver(crumb.path)"
          @dragleave="dragLeave(crumb.path)"
          @drop.prevent.stop="onDrop(crumb.path, $event)"
        >
          {{ crumb.name }}
        </button>
      </template>
    </nav>

    <div v-if="canEdit" class="gallery-header">
      <div v-if="creatingFolder" class="new-folder-form">
        <input
          ref="newFolderInputRef"
          v-model="newFolderName"
          class="rk-input inline-input"
          placeholder="Folder name"
          aria-label="Folder name"
          @keyup.enter="submitNewFolder"
          @keyup.esc="creatingFolder = false"
        />
        <button class="rk-icon-btn" aria-label="Create folder" @click="submitNewFolder"><span class="mdi mdi-check"></span></button>
        <button class="rk-icon-btn" aria-label="Cancel" @click="creatingFolder = false"><span class="mdi mdi-close"></span></button>
      </div>
      <button v-else class="rk-btn gallery-action-btn" @click="startNewFolder">
        <span class="mdi mdi-folder-plus-outline"></span> New folder
      </button>
      <slot name="actions" />
    </div>
    <slot name="filters" />

    <!-- Skeleton cards share .gallery-card's footprint so the grid doesn't jump. -->
    <div v-if="loading" class="gallery-grid" role="status" aria-live="polite">
      <span class="rk-visually-hidden">{{ loadingText }}</span>
      <div v-for="n in 8" :key="n" class="skeleton-card" aria-hidden="true">
        <div class="rk-skeleton skeleton-thumb"></div>
        <div class="gallery-card-info">
          <div class="rk-skeleton skeleton-line"></div>
          <div class="rk-skeleton skeleton-line short"></div>
        </div>
      </div>
    </div>
    <div v-else-if="error" class="rk-alert" role="alert">
      <span class="mdi mdi-alert-circle-outline"></span>
      <span>{{ error }}</span>
    </div>
    <div v-else-if="!folders.length && !items.length" class="rk-empty">
      <span class="mdi" :class="emptyIcon"></span>
      <p>{{ emptyText }}</p>
      <slot name="empty-actions" />
    </div>
    <div v-else class="gallery-grid">
      <div
        v-for="folder in folders"
        :key="folder"
        class="gallery-card folder-card"
        :class="{ 'drag-over': dragOverTarget === folderPath(folder) }"
        :draggable="canEdit && renamingFolder !== folder"
        @click="renamingFolder !== folder && $emit('enter-folder', folder)"
        @dragstart="startDrag({ type: 'folder', name: folder })"
        @dragend="endDrag"
        @dragover.prevent="dragOver(folderPath(folder))"
        @dragleave="dragLeave(folderPath(folder))"
        @drop.prevent.stop="onDrop(folderPath(folder), $event)"
      >
        <div v-if="canEdit" class="gallery-card-actions">
          <button class="rk-icon-btn rk-icon-btn--sm gallery-card-tool" title="Rename folder" aria-label="Rename folder" @click.stop="startRename(folder)">
            <span class="mdi mdi-pencil-outline"></span>
          </button>
          <button class="rk-icon-btn rk-icon-btn--sm gallery-card-tool danger" title="Delete folder" aria-label="Delete folder" @click.stop="$emit('delete-folder', folder)">
            <span class="mdi mdi-trash-can-outline"></span>
          </button>
        </div>
        <div class="gallery-card-thumb">
          <span class="mdi mdi-folder folder-icon"></span>
        </div>
        <div class="gallery-card-info">
          <input
            v-if="renamingFolder === folder"
            v-model="renameValue"
            class="gallery-rename-input"
            aria-label="Folder name"
            @click.stop
            @keyup.enter="submitRename(folder)"
            @keyup.esc="renamingFolder = null"
            @blur="submitRename(folder)"
          />
          <span v-else class="gallery-card-name">{{ folder }}</span>
        </div>
      </div>

      <div
        v-for="item in items"
        :key="itemKey(item)"
        class="gallery-card"
        :draggable="canEdit && renamingItem !== itemKey(item)"
        @click="renamingItem !== itemKey(item) && $emit('open-item', item)"
        @dragstart="startDrag({ type: 'item', item })"
        @dragend="endDrag"
      >
        <div v-if="canEdit" class="gallery-card-actions">
          <button
            v-if="itemCopyText && itemCopyText(item)"
            class="rk-icon-btn rk-icon-btn--sm gallery-card-tool"
            :title="copiedItem === itemKey(item) ? 'Copied!' : 'Copy'"
            :aria-label="copiedItem === itemKey(item) ? 'Copied' : 'Copy reference'"
            @click.stop="copyItem(item)"
          >
            <span class="mdi" :class="copiedItem === itemKey(item) ? 'mdi-check' : 'mdi-content-copy'"></span>
          </button>
          <button class="rk-icon-btn rk-icon-btn--sm gallery-card-tool" title="Rename" aria-label="Rename" @click.stop="startItemRename(item)">
            <span class="mdi mdi-pencil-outline"></span>
          </button>
          <button class="rk-icon-btn rk-icon-btn--sm gallery-card-tool danger" title="Delete" aria-label="Delete" @click.stop="$emit('delete-item', item)">
            <span class="mdi mdi-trash-can-outline"></span>
          </button>
        </div>
        <div class="gallery-card-thumb">
          <slot name="thumb" :item="item" />
        </div>
        <div class="gallery-card-info">
          <input
            v-if="renamingItem === itemKey(item)"
            v-model="itemRenameValue"
            class="gallery-rename-input"
            aria-label="Name"
            @click.stop
            @keyup.enter="submitItemRename(item)"
            @keyup.esc="renamingItem = null"
            @blur="submitItemRename(item)"
          />
          <span v-else class="gallery-card-name">{{ item.name }}</span>
          <span v-if="item.description" class="gallery-card-desc">{{ item.description }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { useDragMove } from '@/composables/useDragMove'
import { useCopyToClipboard } from '@/composables/useCopyToClipboard'

const props = defineProps({
  folders: { type: Array, default: () => [] },
  items: { type: Array, default: () => [] },
  itemKey: { type: Function, required: true },
  // When set, an item card also gets a copy button that copies this
  // function's return value to the clipboard (e.g. a markdown image tag, or
  // a `chart:<id>` embed reference). It returns null for an item with no
  // sensible "paste into a note" representation, which gets no button.
  itemCopyText: { type: Function, default: null },
  currentPath: { type: String, default: '' },
  loading: { type: Boolean, default: false },
  error: { type: String, default: null },
  canEdit: { type: Boolean, default: false },
  rootLabel: { type: String, required: true },
  rootIcon: { type: String, default: 'mdi-home-outline' },
  loadingText: { type: String, default: 'Loading...' },
  emptyIcon: { type: String, default: 'mdi-folder-open-outline' },
  emptyText: { type: String, default: 'Nothing here yet.' },
  // Files dragged in from the computer can be dropped here: on the gallery
  // (into the folder on screen) or on a folder or a crumb (into that one),
  // which emits `drop-files` (files, destination path).
  acceptsFiles: { type: Boolean, default: false }
})

const emit = defineEmits([
  'navigate', 'enter-folder', 'open-item', 'delete-folder', 'delete-item',
  'create-folder', 'rename-folder', 'rename-item', 'move', 'drop-files'
])

const { dragOverTarget, startDrag, endDrag, dragOver, dragLeave, drop } = useDragMove()

const galleryRef = ref(null)
const creatingFolder = ref(false)
const newFolderName = ref('')
const newFolderInputRef = ref(null)
const renamingFolder = ref(null)
const renameValue = ref('')
const renamingItem = ref(null)
const itemRenameValue = ref('')
const { copiedKey: copiedItem, copy } = useCopyToClipboard()

watch(() => props.currentPath, () => { creatingFolder.value = false; renamingFolder.value = null; renamingItem.value = null })

const breadcrumb = computed(() => {
  const segments = props.currentPath.split('/').filter(Boolean)
  const trail = []
  let acc = ''
  for (const name of segments) {
    acc = acc ? `${acc}/${name}` : name
    trail.push({ name, path: acc })
  }
  return trail
})

function folderPath(folder) {
  return props.currentPath ? `${props.currentPath}/${folder}` : folder
}

const filesOver = ref(false)
const carriesFiles = (event) => props.acceptsFiles && props.canEdit && [...(event.dataTransfer?.types || [])].includes('Files')

function droppedFiles(event, destPath) {
  if (!carriesFiles(event)) return false
  filesOver.value = false
  dragOverTarget.value = null
  const files = [...event.dataTransfer.files]
  if (files.length) emit('drop-files', files, destPath)
  return true
}

function onDrop(destPath, event) {
  if (event && droppedFiles(event, destPath)) return
  drop(destPath, (item, dest) => emit('move', item, dest))
}

function onGalleryDragOver(event) {
  if (!carriesFiles(event)) return
  event.preventDefault()
  filesOver.value = true
}

function onGalleryDragLeave(event) {
  if (!galleryRef.value?.contains(event.relatedTarget)) filesOver.value = false
}

function onGalleryDrop(event) {
  if (!carriesFiles(event)) return
  event.preventDefault()
  droppedFiles(event, props.currentPath)
}

function startNewFolder() {
  creatingFolder.value = true
  newFolderName.value = ''
  nextTick(() => newFolderInputRef.value?.focus())
}

function submitNewFolder() {
  const name = newFolderName.value.trim()
  creatingFolder.value = false
  if (!name) return
  emit('create-folder', name)
}

function startRename(folder) {
  renamingFolder.value = folder
  renameValue.value = folder
  nextTick(() => {
    const el = galleryRef.value?.querySelector('.gallery-rename-input')
    el?.focus()
    el?.select()
  })
}

function submitRename(folder) {
  if (renamingFolder.value !== folder) return
  const newName = renameValue.value.trim()
  renamingFolder.value = null
  if (!newName || newName === folder) return
  emit('rename-folder', folder, newName)
}

function startItemRename(item) {
  renamingItem.value = props.itemKey(item)
  itemRenameValue.value = item.name
  nextTick(() => {
    const el = galleryRef.value?.querySelector('.gallery-rename-input')
    el?.focus()
    el?.select()
  })
}

function submitItemRename(item) {
  const key = props.itemKey(item)
  if (renamingItem.value !== key) return
  const newName = itemRenameValue.value.trim()
  renamingItem.value = null
  if (!newName || newName === item.name) return
  emit('rename-item', item, newName)
}

function copyItem(item) {
  copy(props.itemCopyText?.(item), props.itemKey(item))
}
</script>

<style scoped>
.folder-gallery {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

/* Files dragged in from the computer: the folder on screen takes them. */
.folder-gallery.files-over {
  outline: 2px dashed var(--accent-strong);
  outline-offset: var(--space-2);
  border-radius: var(--radius-md);
}

/* ── Breadcrumb ────────────────────────────────────────────────── */
.breadcrumb {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  flex-wrap: wrap;
}

.breadcrumb-item {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  min-height: var(--control-sm);
  padding: 0 var(--space-2);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: var(--text-sm);
  transition:
    background-color var(--duration-fast) var(--ease-out),
    color var(--duration-fast) var(--ease-out),
    transform var(--duration-fast) var(--ease-out);
}

.breadcrumb-item:hover {
  background: var(--hover-tint);
  color: var(--text-primary);
}

.breadcrumb-item:active:not(.current) {
  transform: translateY(1px);
}

.breadcrumb-item.current {
  color: var(--text-primary);
  font-weight: 500;
  cursor: default;
}

.breadcrumb-item.drag-over {
  background: var(--accent-strong);
  color: var(--accent-contrast);
}

.breadcrumb-sep {
  color: var(--text-muted);
  font-size: 1rem;
}

/* ── Header actions ────────────────────────────────────────────── */
.gallery-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-3);
}

/* Dashed "add" variant layered over .rk-btn. :deep() so it also styles the
   #actions / #empty-actions slot buttons, which every gallery (vistas,
   charts, assets) renders with this same class from its own template
   (parent scope, not FolderGallery's). */
.folder-gallery :deep(.gallery-action-btn) {
  border-style: dashed;
  background: transparent;
  color: var(--text-secondary);
}

.folder-gallery :deep(.gallery-action-btn:hover) {
  border-style: solid;
  background: var(--hover-tint);
  color: var(--text-primary);
}

.new-folder-form {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}

/* Compact .rk-input for the inline header forms; :deep() so the parents'
   own "new item" forms in the #actions slot share it. */
.folder-gallery :deep(.inline-input) {
  width: 220px;
  min-height: var(--control-md);
  font-size: var(--text-sm);
}

/* ── Grid & cards ──────────────────────────────────────────────── */
.gallery-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: var(--space-5);
}

.gallery-card {
  position: relative;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  cursor: pointer;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg);
  background: var(--surface-raised);
  transition:
    border-color var(--duration-base) var(--ease-out),
    background-color var(--duration-base) var(--ease-out),
    transform var(--duration-base) var(--ease-out),
    box-shadow var(--duration-base) var(--ease-out);
}

.gallery-card:hover {
  border-color: var(--accent);
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}

.gallery-card:active {
  transform: translateY(0);
}

.gallery-card.drag-over {
  border-color: var(--accent);
  background: var(--accent-a20);
}

.gallery-card-actions {
  position: absolute;
  top: var(--space-2);
  right: var(--space-2);
  z-index: var(--z-raised);
  display: flex;
  gap: var(--space-1);
  opacity: 0;
  transition: opacity var(--duration-fast) var(--ease-out);
}

.gallery-card:hover .gallery-card-actions,
.gallery-card-actions:focus-within {
  opacity: 1;
}

/* Opaque backing so the tools stay legible over any thumbnail. */
.gallery-card-tool {
  background: var(--surface-chrome);
}

.gallery-card-tool.danger:hover:not(:disabled) {
  background: var(--status-error-bg);
  color: var(--status-error);
}

.gallery-rename-input {
  width: 100%;
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--accent);
  border-radius: var(--radius-sm);
  background: var(--surface-sunken);
  color: var(--text-primary);
  font-size: var(--text-sm);
}

.gallery-rename-input:focus,
.gallery-rename-input:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px var(--accent-a20);
  border-radius: var(--radius-sm);
}

.gallery-card-thumb {
  position: relative;
  aspect-ratio: 16 / 10;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: var(--surface-sunken);
}

.gallery-card-thumb :deep(img) {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* Folder and placeholder glyphs keep the muted look they always rendered
   with (the old amber .folder-icon rule never won on specificity). */
.gallery-card-thumb :deep(.mdi) {
  font-size: 2.5rem;
  color: var(--text-secondary);
  opacity: 0.5;
}

.gallery-card-info {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-3);
}

.gallery-card-name {
  color: var(--text-primary);
  font-weight: 500;
  font-size: var(--text-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.gallery-card-desc {
  color: var(--text-secondary);
  font-size: var(--text-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── Loading skeleton ──────────────────────────────────────────── */
.skeleton-card {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg);
  background: var(--surface-raised);
}

.skeleton-thumb {
  aspect-ratio: 16 / 10;
  border-radius: 0;
}

.skeleton-line {
  height: 0.75rem;
  width: 70%;
}

.skeleton-line.short {
  width: 40%;
}
</style>
