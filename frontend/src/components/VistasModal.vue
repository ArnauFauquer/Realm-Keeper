<template>
  <div v-if="isOpen" class="modal-overlay" @click.self="closeModal">
    <div class="modal-content vistas-modal-content">
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
        @back="backToGallery"
        @save="saveNow"
        @send-to-screen="sendToScreen"
        @close="closeModal"
      />

      <div class="modal-body vistas-body">
        <!-- Gallery -->
        <div v-if="view === 'gallery'" class="gallery-view">
          <FolderGallery
            :folders="folders"
            :items="vistas"
            :item-key="(v) => v.id"
            :current-path="currentPath"
            :loading="loading"
            :error="error"
            :can-edit="!!user"
            root-label="Vistas"
            root-icon="mdi-image-frame"
            loading-text="Loading vistas..."
            empty-icon="mdi-image-frame"
            empty-text="No vistas yet."
            @navigate="goToPath"
            @enter-folder="enterFolder"
            @open-item="(v) => openVista(v.id)"
            @delete-folder="onDeleteFolder"
            @delete-item="onDeleteVista"
            @create-folder="onCreateFolder"
            @move="onMove"
          >
            <template #actions>
              <div v-if="showNewVistaInput" class="new-vista-form">
                <input
                  ref="newVistaInputRef"
                  v-model="newVistaName"
                  placeholder="Vista name"
                  @keyup.enter="submitNewVista"
                  @keyup.esc="showNewVistaInput = false"
                />
                <button class="icon-btn" @click="submitNewVista"><span class="mdi mdi-check"></span></button>
                <button class="icon-btn" @click="showNewVistaInput = false"><span class="mdi mdi-close"></span></button>
              </div>
              <button v-else class="gallery-action-btn" @click="startNewVista">
                <span class="mdi mdi-plus"></span> New vista
              </button>
            </template>
            <template #empty-actions>
              <button v-if="user" class="gallery-action-btn" @click="startNewVista">
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
          <div v-if="loadingVista" class="hint-state">Loading vista...</div>
          <template v-else-if="activeVista">
            <VistaCanvas
              :vista="activeVista"
              :editable="!!user"
              @change="onCanvasChange"
              @upload-background="onUploadBackground"
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
import { post } from '@/api/http'
import { apiUrl } from '@/config/env'
import { resolveUrl } from '@/utils/resolveUrl'
import * as vistasApi from '@/api/vistas'

const { isOpen, close } = useVistasModal()
const { user } = useAuth()
const {
  folders, vistas, loading, error,
  fetchTree, createVista, removeVista, moveVista,
  createFolder, removeFolder, moveFolder
} = useVistas()

const view = ref('gallery')
const currentPath = ref('')
const showNewVistaInput = ref(false)
const newVistaName = ref('')
const newVistaInputRef = ref(null)

const activeVista = ref(null)
const loadingVista = ref(false)
const sendingToScreen = ref(false)
const hasUnsavedChanges = ref(false)
const saving = ref(false)

watch(isOpen, (open) => {
  if (open && view.value === 'gallery') {
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

const { confirmDiscard } = useUnsavedChangesGuard(
  hasUnsavedChanges, 'You have unsaved changes to this vista. Discard them?'
)

function closeModal() {
  if (!confirmDiscard()) return
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

async function onUploadBackground(file) {
  if (!activeVista.value) return
  try {
    const updated = await vistasApi.uploadVistaBackground(activeVista.value.id, file)
    activeVista.value.background_url = updated.background_url
  } catch (err) {
    console.error('Failed to upload background:', err)
  }
}

async function sendToScreen() {
  if (!activeVista.value) return
  try {
    await post(`${apiUrl}/api/screen/vista`, { vista_id: activeVista.value.id })
    sendingToScreen.value = true
    setTimeout(() => { sendingToScreen.value = false }, 2000)
  } catch (err) {
    console.error('Failed to send vista to screen:', err)
  }
}
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal-content.vistas-modal-content {
  background: rgba(18, 19, 42, 0.98);
  border: 1px solid var(--border-light);
  border-radius: 12px;
  width: 95vw;
  max-width: 1400px;
  height: 90vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
}

.modal-body.vistas-body {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.gallery-view {
  flex: 1;
  overflow-y: auto;
  padding: 1.5rem;
}

.new-vista-form {
  display: flex;
  gap: 0.4rem;
}

.new-vista-form input {
  background: rgba(26, 27, 58, 0.6);
  border: 1px solid var(--border-light);
  border-radius: 6px;
  padding: 0.5rem 0.7rem;
  color: var(--text-primary);
}

.new-vista-form input:focus {
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
}

.hint-state {
  color: var(--text-secondary);
  text-align: center;
  padding: 2rem;
}

.hint-state.error {
  color: var(--status-error);
}

.editor-view {
  flex: 1;
  overflow: hidden;
  display: flex;
}
</style>
