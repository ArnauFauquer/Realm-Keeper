<template>
  <div v-if="isOpen" class="modal-overlay" @click.self="close">
    <div class="modal-content library-modal-content">
      <div class="modal-header">
        <h2><span class="mdi mdi-folder-multiple-image"></span> Asset Library</h2>
        <button class="close-btn" @click="close">
          <span class="mdi mdi-close"></span>
        </button>
      </div>

      <div class="breadcrumb">
        <button class="breadcrumb-item" :class="{ current: currentFolderId === null }" @click="goToBreadcrumb(null)">
          <span class="mdi mdi-home-outline"></span> Library
        </button>
        <template v-for="crumb in breadcrumb" :key="crumb.id">
          <span class="breadcrumb-sep mdi mdi-chevron-right"></span>
          <button class="breadcrumb-item" :class="{ current: crumb.id === currentFolderId }" @click="goToBreadcrumb(crumb.id)">
            {{ crumb.name }}
          </button>
        </template>
      </div>

      <div class="modal-body library-body">
        <div v-if="loading" class="hint-state">Loading library...</div>
        <div v-else-if="error" class="hint-state error">{{ error }}</div>
        <template v-else>
          <div class="library-grid">
            <div v-if="creatingFolder" class="library-tile new-folder-tile">
              <span class="mdi mdi-folder-plus-outline"></span>
              <input
                ref="newFolderInputRef"
                v-model="newFolderName"
                class="new-folder-input"
                placeholder="Album name"
                @keyup.enter="submitNewFolder"
                @keyup.esc="creatingFolder = false"
                @click.stop
              />
              <div class="new-folder-actions">
                <button class="icon-btn" @click.stop="submitNewFolder"><span class="mdi mdi-check"></span></button>
                <button class="icon-btn" @click.stop="creatingFolder = false"><span class="mdi mdi-close"></span></button>
              </div>
            </div>
            <button v-else class="library-tile new-tile" @click="startNewFolder">
              <span class="mdi mdi-folder-plus-outline"></span>
              <span>New album</span>
            </button>

            <label class="library-tile new-tile upload-tile" :class="{ uploading }">
              <span class="mdi" :class="uploading ? 'mdi-loading mdi-spin' : 'mdi-upload'"></span>
              <span>{{ uploading ? 'Uploading...' : 'Upload new' }}</span>
              <input type="file" accept="image/*" hidden :disabled="uploading" @change="onFileSelected" />
            </label>

            <div
              v-for="folder in visibleFolders"
              :key="folder.id"
              class="library-tile folder-tile"
              @click="enterFolder(folder)"
            >
              <button class="library-tile-delete" title="Delete album" @click.stop="removeFolderItem(folder)">
                <span class="mdi mdi-trash-can-outline"></span>
              </button>
              <span class="mdi mdi-folder library-tile-thumb folder-icon"></span>
              <span class="library-tile-name">{{ folder.name }}</span>
            </div>

            <div v-for="item in visibleAssets" :key="item.id" class="library-tile" @click="pick(item)">
              <button class="library-tile-delete" title="Remove from library" @click.stop="remove(item)">
                <span class="mdi mdi-trash-can-outline"></span>
              </button>
              <div class="library-tile-thumb">
                <img v-if="item.image_url" :src="resolveUrl(item.image_url)" :alt="item.name" />
                <span v-else class="mdi mdi-image-off-outline"></span>
              </div>
              <span class="library-tile-name">{{ item.name }}</span>
            </div>
          </div>

          <div v-if="!visibleFolders.length && !visibleAssets.length" class="empty-state">
            <span class="mdi mdi-folder-open-outline"></span>
            <p>Nothing here yet. Upload an asset or create an album.</p>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import { apiUrl } from '@/config/env'
import { useAssetLibrary } from '@/composables/useAssetLibrary'

const props = defineProps({
  isOpen: { type: Boolean, default: false }
})

const emit = defineEmits(['close', 'select'])

const {
  assets, folders, loading, error,
  fetchLibrary, fetchFolders,
  createLibraryAsset, removeLibraryAsset,
  createLibraryFolder, removeLibraryFolder
} = useAssetLibrary()

const uploading = ref(false)
const currentFolderId = ref(null)
const creatingFolder = ref(false)
const newFolderName = ref('')
const newFolderInputRef = ref(null)

watch(() => props.isOpen, (open) => {
  if (open) {
    currentFolderId.value = null
    creatingFolder.value = false
    fetchLibrary()
    fetchFolders()
  }
})

const folderMap = computed(() => new Map(folders.value.map(f => [f.id, f])))

const breadcrumb = computed(() => {
  const trail = []
  let id = currentFolderId.value
  while (id) {
    const folder = folderMap.value.get(id)
    if (!folder) break
    trail.unshift(folder)
    id = folder.parent_id
  }
  return trail
})

const visibleFolders = computed(() =>
  folders.value.filter(f => (f.parent_id ?? null) === currentFolderId.value)
)

const visibleAssets = computed(() =>
  assets.value.filter(a => (a.folder_id ?? null) === currentFolderId.value)
)

function resolveUrl(url) {
  if (!url) return url
  return url.startsWith('http') ? url : `${apiUrl}${url}`
}

function close() {
  emit('close')
}

function pick(item) {
  emit('select', item)
}

function enterFolder(folder) {
  currentFolderId.value = folder.id
  creatingFolder.value = false
}

function goToBreadcrumb(folderId) {
  currentFolderId.value = folderId
  creatingFolder.value = false
}

function startNewFolder() {
  creatingFolder.value = true
  newFolderName.value = ''
  nextTick(() => newFolderInputRef.value?.focus())
}

async function submitNewFolder() {
  const name = newFolderName.value.trim()
  if (!name) { creatingFolder.value = false; return }
  creatingFolder.value = false
  try {
    await createLibraryFolder(name, currentFolderId.value)
  } catch (err) {
    console.error('Failed to create album:', err)
  }
}

async function removeFolderItem(folder) {
  if (!window.confirm(`Delete album "${folder.name}" and everything inside it?`)) return
  try {
    await removeLibraryFolder(folder.id)
  } catch (err) {
    console.error('Failed to delete album:', err)
  }
}

async function onFileSelected(evt) {
  const file = evt.target.files[0]
  evt.target.value = ''
  if (!file) return
  uploading.value = true
  try {
    const name = file.name.replace(/\.[^.]+$/, '')
    const item = await createLibraryAsset(name, file, currentFolderId.value)
    emit('select', item)
  } catch (err) {
    console.error('Failed to upload to asset library:', err)
  } finally {
    uploading.value = false
  }
}

async function remove(item) {
  try {
    await removeLibraryAsset(item.id)
  } catch (err) {
    console.error('Failed to remove library asset:', err)
  }
}
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  z-index: 2100;
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal-content.library-modal-content {
  background: rgba(18, 19, 42, 0.98);
  border: 1px solid var(--border-light);
  border-radius: 12px;
  width: 90vw;
  max-width: 900px;
  height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1.25rem 1.5rem;
  border-bottom: 1px solid var(--border-light);
}

.modal-header h2 {
  margin: 0;
  font-size: 1.25rem;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.close-btn {
  background: transparent;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 0.25rem;
  border-radius: 4px;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
}

.close-btn:hover {
  background: var(--interactive-secondary);
  color: var(--text-primary);
}

.close-btn .mdi {
  font-size: 1.5rem;
}

.breadcrumb {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.75rem 1.5rem;
  border-bottom: 1px solid var(--border-light);
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

.breadcrumb-sep {
  color: var(--text-secondary);
  opacity: 0.5;
  font-size: 1rem;
}

.library-body {
  flex: 1;
  overflow-y: auto;
  padding: 1.5rem;
}

.hint-state {
  color: var(--text-secondary);
  text-align: center;
  padding: 2rem;
}

.hint-state.error {
  color: var(--status-error);
}

.library-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 1rem;
}

.library-tile {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem;
  border: 1px solid var(--border-light);
  border-radius: 10px;
  background: rgba(26, 27, 58, 0.4);
  cursor: pointer;
  transition: all 0.2s ease;
}

.library-tile:hover {
  border-color: var(--interactive-primary);
  transform: translateY(-2px);
}

.library-tile-thumb {
  width: 100%;
  aspect-ratio: 1;
  border-radius: 6px;
  overflow: hidden;
  background: rgba(12, 13, 29, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
}

.library-tile-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.library-tile-thumb .mdi {
  font-size: 2rem;
  color: var(--text-secondary);
  opacity: 0.5;
}

.folder-icon {
  font-size: 2.5rem;
  color: #fbbf24;
  opacity: 0.85;
  background: rgba(12, 13, 29, 0.6);
}

.library-tile-name {
  font-size: 0.8rem;
  color: var(--text-primary);
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  width: 100%;
}

.library-tile-delete {
  position: absolute;
  top: 0.35rem;
  right: 0.35rem;
  width: 24px;
  height: 24px;
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

.library-tile:hover .library-tile-delete {
  opacity: 1;
}

.library-tile-delete:hover {
  background: rgba(248, 113, 113, 0.2);
  color: var(--status-error, #f87171);
}

.new-tile {
  border-style: dashed;
  color: var(--text-secondary);
  justify-content: center;
}

.new-tile .mdi {
  font-size: 2rem;
}

.new-tile:hover {
  border-color: var(--interactive-primary);
  color: var(--text-primary);
}

.upload-tile.uploading {
  pointer-events: none;
  opacity: 0.6;
}

.new-folder-tile {
  border-style: dashed;
  cursor: default;
  justify-content: center;
}

.new-folder-tile .mdi {
  font-size: 1.75rem;
  color: var(--text-secondary);
}

.new-folder-input {
  width: 100%;
  box-sizing: border-box;
  background: rgba(26, 27, 58, 0.6);
  border: 1px solid var(--border-light);
  border-radius: 6px;
  padding: 0.3rem 0.5rem;
  color: var(--text-primary);
  font-size: 0.8rem;
  text-align: center;
}

.new-folder-input:focus {
  outline: none;
  border-color: var(--interactive-primary);
}

.new-folder-actions {
  display: flex;
  gap: 0.4rem;
}

.icon-btn {
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  background: var(--interactive-secondary);
  border: 1px solid var(--border-light);
  color: var(--text-primary);
  cursor: pointer;
}

.mdi-spin {
  animation: mdi-spin 1s linear infinite;
}

@keyframes mdi-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  color: var(--text-secondary);
  padding: 3rem 1rem;
  text-align: center;
}

.empty-state .mdi {
  font-size: 2.5rem;
  opacity: 0.5;
}
</style>
