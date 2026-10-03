<template>
  <div v-if="isOpen" class="rk-scrim" @click.self="closeModal">
    <div class="rk-dialog vistas-modal-content" role="dialog" aria-modal="true" aria-label="Vistas">
      <DocumentModalHeader
        :view="view"
        icon="mdi-image-frame"
        gallery-title="Vistas"
        :item-title="activeVista?.name"
        :can-edit="!!user"
        :has-unsaved-changes="hasUnsavedChanges"
        :saving="saving"
        :can-send-to-screen="!!activeVista?.background_url"
        :sending-to-screen="sendingToScreen"
        live-supported
        :live="live"
        :copy-text="activeVista && docRefMarkdown('vista', activeVista.id)"
        @back="backToGallery"
        @save="saveNow"
        @send-to-screen="sendToScreen"
        @toggle-live="toggleLive(hasUnsavedChanges)"
        @close="closeModal"
      />

      <div class="vistas-body">
        <!-- Gallery -->
        <div v-if="view === 'gallery'" class="gallery-view">
          <FolderGallery
            :folders="folders"
            :items="vistas"
            :item-key="(v) => v.id"
            :item-copy-text="(v) => docRefMarkdown('vista', v.id)"
            :current-path="currentPath"
            :loading="loading"
            :error="error"
            :can-edit="!!user"
            root-label="Vistas"
            root-icon="mdi-image-frame"
            loading-text="Loading vistas..."
            empty-icon="mdi-image-frame"
            empty-text="No vistas yet. Create one to stage a scene for the table screen."
            @navigate="goToPath"
            @enter-folder="enterFolder"
            @open-item="(v) => openVista(v.id)"
            @delete-folder="onDeleteFolder"
            @delete-item="onDeleteVista"
            @create-folder="onCreateFolder"
            @rename-folder="onRenameFolder"
            @rename-item="onRenameVista"
            @move="onMove"
          >
            <template #actions>
              <div v-if="showNewVistaInput" class="new-vista-form">
                <input
                  ref="newVistaInputRef"
                  v-model="newVistaName"
                  class="rk-input inline-input"
                  placeholder="Vista name"
                  aria-label="Vista name"
                  @keyup.enter="submitNewVista"
                  @keyup.esc="showNewVistaInput = false"
                />
                <button class="rk-icon-btn" aria-label="Create vista" @click="submitNewVista"><span class="mdi mdi-check"></span></button>
                <button class="rk-icon-btn" aria-label="Cancel" @click="showNewVistaInput = false"><span class="mdi mdi-close"></span></button>
              </div>
              <button v-else class="rk-btn gallery-action-btn" @click="startNewVista">
                <span class="mdi mdi-plus"></span> New vista
              </button>
            </template>
            <template #thumb="{ item }">
              <img v-if="item.background_url" :src="resolveUrl(item.background_url)" :alt="item.name" />
              <span v-else class="mdi mdi-image-outline"></span>
            </template>
          </FolderGallery>
        </div>

        <!-- Editor / viewer -->
        <div v-else-if="view === 'editor'" class="editor-view">
          <div v-if="loadingVista" class="loading-state" role="status">
            <span class="rk-spinner rk-spinner--lg"></span>
            <span>Loading vista...</span>
          </div>
          <template v-else-if="activeVista">
            <VistaCanvas
              :vista="activeVista"
              :editable="!!user"
              @change="onCanvasChange"
              @set-background="onSetBackground"
            />
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, nextTick } from 'vue'
import VistaCanvas from './VistaCanvas.vue'
import FolderGallery from './FolderGallery.vue'
import DocumentModalHeader from './DocumentModalHeader.vue'
import { useAuth } from '@/composables/useAuth'
import { useVistasModal } from '@/composables/useVistasModal'
import { useVistas } from '@/composables/useVistas'
import { useUnsavedChangesGuard } from '@/composables/useUnsavedChangesGuard'
import { useLiveScreen } from '@/composables/useLiveScreen'
import { resolveUrl } from '@/utils/resolveUrl'
import { docRefMarkdown } from '@/utils/inlineRefs'
import * as vistasApi from '@/api/vistas'

const { isOpen, targetId, close } = useVistasModal()
const { user } = useAuth()
const {
  folders, vistas, loading, error,
  fetchTree, createVista, removeVista, moveVista, renameVista,
  createFolder, removeFolder, renameFolder, moveFolder
} = useVistas()

const view = ref('gallery')
const currentPath = ref('')
const showNewVistaInput = ref(false)
const newVistaName = ref('')
const newVistaInputRef = ref(null)

const activeVista = ref(null)
const loadingVista = ref(false)
const hasUnsavedChanges = ref(false)
const saving = ref(false)

watch(isOpen, (open) => {
  if (open && targetId.value) {
    // Opened from a vista embedded in a note: skip the gallery.
    openVista(targetId.value)
    targetId.value = null
  } else if (open && view.value === 'gallery') {
    currentPath.value = ''
    fetchTree('')
  }
})

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
      await moveVista(currentPath.value, dragItem.item.id, destPath)
    }
  } catch (err) {
    error.value = err.response?.data?.detail || err.message
  }
}

// What the screen needs to draw the vista as it is right now, saved or not.
const { live, sending: sendingToScreen, sendToScreen, toggle: toggleLive, stop: stopLive } = useLiveScreen(
  'vista', activeVista,
  (v) => ({
    vista_id: v.id,
    background_url: v.background_url,
    vanishing_point: v.vanishing_point,
    background_offset_y: v.background_offset_y,
    assets: v.assets
  })
)

const { confirmDiscard } = useUnsavedChangesGuard(
  hasUnsavedChanges, 'You have unsaved changes to this vista. Discard them?'
)

function closeModal() {
  if (!confirmDiscard()) return
  stopLive({ revert: hasUnsavedChanges.value })
  close()
  view.value = 'gallery'
  activeVista.value = null
  hasUnsavedChanges.value = false
}

function startNewVista() {
  showNewVistaInput.value = true
  nextTick(() => newVistaInputRef.value?.focus())
}

async function submitNewVista() {
  const name = newVistaName.value.trim()
  if (!name) return
  newVistaName.value = ''
  showNewVistaInput.value = false
  try {
    const vista = await createVista(name, '', currentPath.value)
    openVista(vista.id)
  } catch (err) {
    error.value = err.response?.data?.detail || err.message
  }
}

async function onDeleteVista(vista) {
  if (!window.confirm(`Delete vista "${vista.name}"? This cannot be undone.`)) return
  try {
    await removeVista(currentPath.value, vista.id)
  } catch (err) {
    error.value = err.response?.data?.detail || err.message
  }
}

async function onRenameVista(vista, name) {
  try {
    await renameVista(currentPath.value, vista.id, name)
  } catch (err) {
    error.value = err.response?.data?.detail || err.message
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
    error.value = err.response?.data?.detail || err.message
  }
}

async function onRenameFolder(folder, name) {
  try {
    await renameFolder(currentPath.value, folderPath(folder), name)
  } catch (err) {
    error.value = err.response?.data?.detail || err.message
  }
}

async function onDeleteFolder(folder) {
  if (!window.confirm(`Delete folder "${folder}" and everything inside it?`)) return
  try {
    await removeFolder(currentPath.value, folderPath(folder))
  } catch (err) {
    error.value = err.response?.data?.detail || err.message
  }
}

async function openVista(vistaId) {
  view.value = 'editor'
  loadingVista.value = true
  try {
    activeVista.value = await vistasApi.fetchVista(vistaId)
    hasUnsavedChanges.value = false
  } catch (err) {
    error.value = err.response?.data?.detail || err.message
    view.value = 'gallery'
  } finally {
    loadingVista.value = false
  }
}

function backToGallery() {
  if (!confirmDiscard()) return
  stopLive({ revert: hasUnsavedChanges.value })
  view.value = 'gallery'
  activeVista.value = null
  hasUnsavedChanges.value = false
  fetchTree(currentPath.value)
}

async function saveNow() {
  const vista = activeVista.value
  if (!vista || saving.value) return
  saving.value = true
  try {
    await vistasApi.saveVista(vista.id, {
      name: vista.name,
      description: vista.description,
      vanishing_point: vista.vanishing_point,
      background_offset_y: vista.background_offset_y,
      assets: vista.assets
    })
    hasUnsavedChanges.value = false
  } catch (err) {
    console.error('Failed to save vista:', err)
  } finally {
    saving.value = false
  }
}

function onCanvasChange() {
  hasUnsavedChanges.value = true
}

async function onSetBackground(url) {
  if (!activeVista.value) return
  try {
    const updated = await vistasApi.setVistaBackground(activeVista.value.id, url)
    activeVista.value.background_url = updated.background_url
  } catch (err) {
    console.error('Failed to set background:', err)
  }
}
</script>

<style scoped>
/* Shell comes from .rk-scrim / .rk-dialog; only the large-canvas size lives here. */
.vistas-modal-content {
  width: min(100%, 1400px);
  height: 90dvh;
}

.vistas-body {
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

.new-vista-form {
  display: flex;
  align-items: center;
  gap: var(--space-1);
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

.editor-view {
  flex: 1;
  overflow: hidden;
  display: flex;
}
</style>
