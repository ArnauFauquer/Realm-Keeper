<template>
  <div v-if="isOpen" class="rk-scrim library-scrim" @click.self="close">
    <div class="rk-dialog library-modal-content" role="dialog" aria-modal="true" aria-label="Asset Library">
      <DocumentModalHeader
        :view="view === 'viewer' ? 'editor' : 'gallery'"
        icon="mdi-folder-multiple-image"
        gallery-title="Asset Library"
        :item-title="activeAsset?.name"
        :can-edit="!!user"
        :show-save="false"
        :can-send-to-screen="!!activeAsset"
        :sending-to-screen="sendingToScreen"
        @back="backToGallery"
        @send-to-screen="sendToScreen"
        @close="close"
      />

      <div v-if="view === 'gallery'" class="library-body">
        <FolderGallery
          :folders="folders"
          :items="assets"
          :item-key="(item) => item.key"
          :item-copy-text="(item) => `![${item.name}](${copyAssetUrl(item)})`"
          :current-path="currentPath"
          :loading="loading"
          :error="error"
          :can-edit="!!user"
          root-label="Library"
          loading-text="Loading library..."
          empty-text="Nothing here yet. Upload an asset or create an album."
          @navigate="goToPath"
          @enter-folder="enterFolder"
          @open-item="pick"
          @delete-folder="removeFolderItem"
          @delete-item="remove"
          @create-folder="onCreateFolder"
          @rename-folder="onRenameFolder"
          @rename-item="onRenameAsset"
          @move="onMove"
        >
          <template #actions>
            <label class="rk-btn gallery-action-btn upload-btn" :class="{ uploading }">
              <span v-if="uploading" class="rk-spinner" aria-hidden="true"></span>
              <span v-else class="mdi mdi-upload"></span>
              <span>{{ uploading ? 'Uploading...' : 'Upload new' }}</span>
              <input type="file" accept="image/*" multiple hidden :disabled="uploading" @change="onFileSelected" />
            </label>
          </template>
          <template #thumb="{ item }">
            <img :src="resolveUrl(assetUrl(item))" :alt="item.name" />
          </template>
        </FolderGallery>
      </div>

      <div v-else class="viewer-view">
        <img v-if="activeAsset" :src="resolveUrl(assetUrl(activeAsset))" :alt="activeAsset.name" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'
import { resolveUrl, absoluteUrl } from '@/utils/resolveUrl'
import { useAuth } from '@/composables/useAuth'
import { useAssetLibrary } from '@/composables/useAssetLibrary'
import { post } from '@/api/http'
import { apiUrl } from '@/config/env'
import FolderGallery from './FolderGallery.vue'
import DocumentModalHeader from './DocumentModalHeader.vue'

const props = defineProps({
  isOpen: { type: Boolean, default: false },
  // true when opened as a picker (e.g. from VistaCanvas): clicking an asset
  // selects it immediately instead of opening the viewer.
  pickerMode: { type: Boolean, default: false }
})

const emit = defineEmits(['close', 'select'])

const { user } = useAuth()
const {
  folders, assets, loading, error,
  fetchPath, uploadAsset, uploadAssets, removeAsset, moveAsset, renameAsset,
  createFolder, removeFolder, renameFolder, moveFolder
} = useAssetLibrary()

const uploading = ref(false)
const currentPath = ref('')
const view = ref('gallery')
const activeAsset = ref(null)
const sendingToScreen = ref(false)

watch(() => props.isOpen, (open) => {
  if (open) {
    currentPath.value = ''
    view.value = 'gallery'
    activeAsset.value = null
    fetchPath('')
  }
})

function assetUrl(item) {
  return `/api/asset-library/assets/${item.key}`
}

// CommonMark link/image destinations can't contain a literal, unescaped
// space (e.g. a "Tierras Del Este" folder) — markdown-it then refuses to
// parse it as an image and renders the raw "![...](...)" text instead. The
// <img :src> binding doesn't need this (browsers encode it implicitly), but
// the copy button hands out literal text that has to already be valid.
function copyAssetUrl(item) {
  const encodedKey = item.key.split('/').map(encodeURIComponent).join('/')
  return absoluteUrl(`/api/asset-library/assets/${encodedKey}`)
}

function folderPath(folder) {
  return currentPath.value ? `${currentPath.value}/${folder}` : folder
}

async function onMove(dragItem, destPath) {
  try {
    if (dragItem.type === 'folder') {
      const sourcePath = folderPath(dragItem.name)
      if (sourcePath === destPath) return
      await moveFolder(currentPath.value, sourcePath, destPath)
    } else {
      await moveAsset(currentPath.value, dragItem.item.key, destPath)
    }
  } catch (err) {
    error.value = err.response?.data?.detail || err.message
  }
}

function close() {
  emit('close')
}

function pick(item) {
  if (props.pickerMode) {
    emit('select', { name: item.name.replace(/\.[^.]+$/, ''), image_url: assetUrl(item) })
    return
  }
  activeAsset.value = item
  view.value = 'viewer'
}

function backToGallery() {
  view.value = 'gallery'
  activeAsset.value = null
}

async function sendToScreen() {
  if (!activeAsset.value) return
  try {
    await post(`${apiUrl}/api/screen/display`, {
      url: resolveUrl(assetUrl(activeAsset.value)),
      title: activeAsset.value.name
    })
    sendingToScreen.value = true
    setTimeout(() => { sendingToScreen.value = false }, 2000)
  } catch (err) {
    console.error('Failed to send asset to screen:', err)
  }
}

function enterFolder(folder) {
  currentPath.value = folderPath(folder)
  fetchPath(currentPath.value)
}

function goToPath(path) {
  currentPath.value = path
  fetchPath(path)
}

async function onCreateFolder(name) {
  try {
    await createFolder(currentPath.value, name)
  } catch (err) {
    console.error('Failed to create album:', err)
  }
}

async function onRenameFolder(folder, name) {
  try {
    await renameFolder(currentPath.value, folderPath(folder), name)
  } catch (err) {
    console.error('Failed to rename album:', err)
  }
}

async function removeFolderItem(folder) {
  if (!window.confirm(`Delete album "${folder}" and everything inside it?`)) return
  try {
    await removeFolder(currentPath.value, folderPath(folder))
  } catch (err) {
    console.error('Failed to delete album:', err)
  }
}

async function onFileSelected(evt) {
  const files = Array.from(evt.target.files)
  evt.target.value = ''
  if (!files.length) return
  uploading.value = true
  try {
    if (files.length === 1) {
      const result = await uploadAsset(currentPath.value, files[0])
      emit('select', { name: files[0].name.replace(/\.[^.]+$/, ''), image_url: result.image_url })
    } else {
      await uploadAssets(currentPath.value, files)
    }
  } catch (err) {
    error.value = err.response?.data?.detail || err.message
  } finally {
    uploading.value = false
  }
}

async function remove(item) {
  try {
    await removeAsset(currentPath.value, item.key)
  } catch (err) {
    console.error('Failed to remove library asset:', err)
  }
}

async function onRenameAsset(item, name) {
  try {
    await renameAsset(currentPath.value, item.key, name)
  } catch (err) {
    console.error('Failed to rename library asset:', err)
  }
}
</script>

<style scoped>
/* Opens on top of Vistas/Charts (as a picker), so it sits one layer up. */
.library-scrim {
  z-index: var(--z-modal-nested);
}

.library-modal-content {
  width: min(100%, 1400px);
  height: 90dvh;
}

.library-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--space-6);
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

.upload-btn.uploading {
  pointer-events: none;
  opacity: 0.6;
}

.upload-btn .rk-spinner {
  width: 14px;
  height: 14px;
}
</style>
