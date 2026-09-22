<template>
  <div class="folder-gallery" ref="galleryRef">
    <div class="breadcrumb">
      <button
        class="breadcrumb-item"
        :class="{ current: currentPath === '', 'drag-over': dragOverTarget === '' }"
        @click="$emit('navigate', '')"
        @dragover.prevent="dragOver('')"
        @dragleave="dragLeave('')"
        @drop.prevent="onDrop('')"
      >
        <span class="mdi" :class="rootIcon"></span> {{ rootLabel }}
      </button>
      <template v-for="crumb in breadcrumb" :key="crumb.path">
        <span class="breadcrumb-sep mdi mdi-chevron-right"></span>
        <button
          class="breadcrumb-item"
          :class="{ current: crumb.path === currentPath, 'drag-over': dragOverTarget === crumb.path }"
          @click="$emit('navigate', crumb.path)"
          @dragover.prevent="dragOver(crumb.path)"
          @dragleave="dragLeave(crumb.path)"
          @drop.prevent="onDrop(crumb.path)"
        >
          {{ crumb.name }}
        </button>
      </template>
    </div>

    <div v-if="canEdit" class="gallery-header">
      <div v-if="creatingFolder" class="new-folder-form">
        <input
          ref="newFolderInputRef"
          v-model="newFolderName"
          placeholder="Folder name"
          @keyup.enter="submitNewFolder"
          @keyup.esc="creatingFolder = false"
        />
        <button class="icon-btn" @click="submitNewFolder"><span class="mdi mdi-check"></span></button>
        <button class="icon-btn" @click="creatingFolder = false"><span class="mdi mdi-close"></span></button>
      </div>
      <button v-else class="gallery-action-btn" @click="startNewFolder">
        <span class="mdi mdi-folder-plus-outline"></span> New folder
      </button>
      <slot name="actions" />
    </div>

    <div v-if="loading" class="hint-state">{{ loadingText }}</div>
    <div v-else-if="error" class="hint-state error">{{ error }}</div>
    <div v-else-if="!folders.length && !items.length" class="empty-state">
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
        @drop.prevent="onDrop(folderPath(folder))"
      >
        <div v-if="canEdit" class="gallery-card-actions">
          <button class="gallery-card-tool" title="Rename folder" @click.stop="startRename(folder)">
            <span class="mdi mdi-pencil-outline"></span>
          </button>
          <button class="gallery-card-tool danger" title="Delete folder" @click.stop="$emit('delete-folder', folder)">
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
        :draggable="canEdit"
        @click="$emit('open-item', item)"
        @dragstart="startDrag({ type: 'item', item })"
        @dragend="endDrag"
      >
        <button v-if="canEdit" class="gallery-card-delete" title="Delete" @click.stop="$emit('delete-item', item)">
          <span class="mdi mdi-trash-can-outline"></span>
        </button>
        <div class="gallery-card-thumb">
          <slot name="thumb" :item="item" />
        </div>
        <div class="gallery-card-info">
          <span class="gallery-card-name">{{ item.name }}</span>
          <span v-if="item.description" class="gallery-card-desc">{{ item.description }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { useDragMove } from '@/composables/useDragMove'

const props = defineProps({
  folders: { type: Array, default: () => [] },
  items: { type: Array, default: () => [] },
  itemKey: { type: Function, required: true },
  currentPath: { type: String, default: '' },
  loading: { type: Boolean, default: false },
  error: { type: String, default: null },
  canEdit: { type: Boolean, default: false },
  rootLabel: { type: String, required: true },
  rootIcon: { type: String, default: 'mdi-home-outline' },
  loadingText: { type: String, default: 'Loading...' },
  emptyIcon: { type: String, default: 'mdi-folder-open-outline' },
  emptyText: { type: String, default: 'Nothing here yet.' }
})

const emit = defineEmits([
  'navigate', 'enter-folder', 'open-item', 'delete-folder', 'delete-item',
  'create-folder', 'rename-folder', 'move'
])

const { dragOverTarget, startDrag, endDrag, dragOver, dragLeave, drop } = useDragMove()

const galleryRef = ref(null)
const creatingFolder = ref(false)
const newFolderName = ref('')
const newFolderInputRef = ref(null)
const renamingFolder = ref(null)
const renameValue = ref('')

watch(() => props.currentPath, () => { creatingFolder.value = false; renamingFolder.value = null })

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

function onDrop(destPath) {
  drop(destPath, (item, dest) => emit('move', item, dest))
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
</script>

<style scoped>
.folder-gallery {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.breadcrumb {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  flex-wrap: wrap;
}

.breadcrumb-item {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  background: transparent;
  border: none;
  color: var(--text-secondary);
  font-size: 0.85rem;
  cursor: pointer;
  padding: 0.2rem 0.4rem;
  border-radius: 6px;
}

.breadcrumb-item:hover {
  background: var(--interactive-secondary);
  color: var(--text-primary);
}

.breadcrumb-item.current {
  color: var(--text-primary);
  font-weight: 500;
  cursor: default;
}

.breadcrumb-item.drag-over {
  background: var(--interactive-primary);
  color: white;
}

.breadcrumb-sep {
  color: var(--text-secondary);
  opacity: 0.5;
  font-size: 1rem;
}

.gallery-header {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.75rem;
}

/* :deep() so this also styles the #actions slot's own "new item" button,
   which every gallery (vistas, charts, assets) renders with this same
   class from its own template (parent scope, not FolderGallery's). */
.gallery-header :deep(.gallery-action-btn) {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.55rem 1rem;
  border: 1px dashed var(--border-medium);
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s ease;
  font-size: 0.875rem;
}

.gallery-header :deep(.gallery-action-btn:hover) {
  border-style: solid;
  border-color: var(--interactive-primary);
  background: var(--interactive-secondary);
  color: var(--text-primary);
}

.new-folder-form {
  display: flex;
  gap: 0.4rem;
}

.new-folder-form input {
  background: rgba(26, 27, 58, 0.6);
  border: 1px solid var(--border-light);
  border-radius: 6px;
  padding: 0.5rem 0.7rem;
  color: var(--text-primary);
}

.new-folder-form input:focus {
  outline: none;
  border-color: var(--interactive-primary);
}

.icon-btn {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  background: var(--interactive-secondary);
  border: 1px solid var(--border-light);
  color: var(--text-primary);
  cursor: pointer;
  flex-shrink: 0;
}

.hint-state {
  color: var(--text-secondary);
  text-align: center;
  padding: 2rem;
}

.hint-state.error {
  color: var(--status-error);
}

.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  color: var(--text-secondary);
  padding: 3rem 1rem;
  text-align: center;
}

.empty-state .mdi {
  font-size: 3rem;
  opacity: 0.5;
}

.gallery-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 1.25rem;
}

.gallery-card {
  position: relative;
  border: 1px solid var(--border-light);
  border-radius: 10px;
  overflow: hidden;
  cursor: pointer;
  background: rgba(26, 27, 58, 0.4);
  transition: all 0.2s ease;
  display: flex;
  flex-direction: column;
}

.gallery-card:hover {
  border-color: var(--interactive-primary);
  transform: translateY(-2px);
}

.gallery-card.drag-over {
  border-color: var(--interactive-primary);
  background: var(--interactive-secondary);
}

.gallery-card-delete {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  background: rgba(12, 13, 29, 0.85);
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  opacity: 0;
  transition: all 0.15s ease;
  z-index: 2;
}

.gallery-card:hover .gallery-card-delete {
  opacity: 1;
}

.gallery-card-delete:hover {
  background: rgba(248, 113, 113, 0.2);
  color: var(--status-error, #f87171);
}

.gallery-card-actions {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  display: flex;
  gap: 0.3rem;
  opacity: 0;
  transition: all 0.15s ease;
  z-index: 2;
}

.gallery-card:hover .gallery-card-actions {
  opacity: 1;
}

.gallery-card-tool {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  background: rgba(12, 13, 29, 0.85);
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.15s ease;
}

.gallery-card-tool:hover {
  background: var(--interactive-secondary);
  color: var(--text-primary);
}

.gallery-card-tool.danger:hover {
  background: rgba(248, 113, 113, 0.2);
  color: var(--status-error, #f87171);
}

.gallery-rename-input {
  width: 100%;
  box-sizing: border-box;
  background: rgba(26, 27, 58, 0.6);
  border: 1px solid var(--interactive-primary);
  border-radius: 6px;
  padding: 0.2rem 0.4rem;
  color: var(--text-primary);
  font-size: 0.9rem;
}

.gallery-rename-input:focus {
  outline: none;
}

.gallery-card-thumb {
  aspect-ratio: 16 / 10;
  background: rgba(12, 13, 29, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.gallery-card-thumb :deep(img) {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.gallery-card-thumb :deep(.mdi) {
  font-size: 2.5rem;
  color: var(--text-secondary);
  opacity: 0.5;
}

.folder-icon {
  font-size: 2.5rem;
  color: #fbbf24;
  opacity: 0.85;
}

.gallery-card-info {
  padding: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.gallery-card-name {
  color: var(--text-primary);
  font-weight: 500;
  font-size: 0.9rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.gallery-card-desc {
  color: var(--text-secondary);
  font-size: 0.8rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
