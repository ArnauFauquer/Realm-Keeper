<template>
  <div v-if="isOpen" class="modal-overlay" @click.self="closeModal">
    <div class="modal-content vistas-modal-content">
      <div class="modal-header">
        <h2>
          <button v-if="view === 'editor'" class="back-btn" title="Back to vistas" @click="backToGallery">
            <span class="mdi mdi-arrow-left"></span>
          </button>
          <span class="mdi mdi-image-frame"></span>
          {{ view === 'editor' && activeVista ? activeVista.name : 'Vistas' }}
        </h2>
        <div class="header-actions">
          <button
            v-if="view === 'editor' && user"
            class="header-btn primary"
            :disabled="!hasUnsavedChanges || saving"
            title="Save changes"
            @click="saveNow"
          >
            <span class="mdi mdi-content-save"></span>
            <span>{{ saving ? 'Saving...' : (hasUnsavedChanges ? 'Save' : 'Saved') }}</span>
          </button>
          <button
            v-if="view === 'editor' && user"
            class="header-btn"
            :disabled="!activeVista?.background_url || sendingToScreen"
            title="Send to screen"
            @click="sendToScreen"
          >
            <span class="mdi mdi-monitor-share"></span>
            <span>{{ sendingToScreen ? 'Sent!' : 'Send to screen' }}</span>
          </button>
          <button class="close-btn" @click="closeModal">
            <span class="mdi mdi-close"></span>
          </button>
        </div>
      </div>

      <div class="modal-body vistas-body">
        <!-- Gallery -->
        <div v-if="view === 'gallery'" class="gallery-view">
          <div v-if="user" class="gallery-header">
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
            <button v-else class="new-vista-btn" @click="startNewVista">
              <span class="mdi mdi-plus"></span> New vista
            </button>
          </div>

          <div v-if="loading" class="hint-state">Loading vistas...</div>
          <div v-else-if="error" class="hint-state error">{{ error }}</div>
          <div v-else-if="!vistas.length" class="empty-state">
            <span class="mdi mdi-image-frame"></span>
            <p>No vistas yet.</p>
            <button v-if="user" class="new-vista-btn" @click="startNewVista">
              <span class="mdi mdi-plus"></span> New vista
            </button>
          </div>
          <div v-else class="vista-grid">
            <div v-for="v in vistas" :key="v.id" class="vista-card" @click="openVista(v.id)">
              <button v-if="user" class="vista-card-delete" title="Delete vista" @click.stop="onDeleteVista(v)">
                <span class="mdi mdi-trash-can-outline"></span>
              </button>
              <div class="vista-card-thumb">
                <img v-if="v.background_url" :src="resolveUrl(v.background_url)" :alt="v.name" />
                <span v-else class="mdi mdi-image-outline"></span>
              </div>
              <div class="vista-card-info">
                <span class="vista-card-name">{{ v.name }}</span>
                <span v-if="v.description" class="vista-card-desc">{{ v.description }}</span>
              </div>
            </div>
          </div>
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
import { ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import VistaCanvas from './VistaCanvas.vue'
import { useAuth } from '@/composables/useAuth'
import { useVistasModal } from '@/composables/useVistasModal'
import { useVistas } from '@/composables/useVistas'
import { post } from '@/api/http'
import { apiUrl } from '@/config/env'
import * as vistasApi from '@/api/vistas'

const { isOpen, close } = useVistasModal()
const { user } = useAuth()
const { vistas, loading, error, fetchVistas, createVista, removeVista } = useVistas()

const view = ref('gallery')
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
    fetchVistas()
  }
})

function onBeforeUnload(evt) {
  if (!hasUnsavedChanges.value) return
  evt.preventDefault()
  evt.returnValue = ''
}
onMounted(() => window.addEventListener('beforeunload', onBeforeUnload))
onBeforeUnmount(() => window.removeEventListener('beforeunload', onBeforeUnload))

function confirmDiscard() {
  return !hasUnsavedChanges.value || window.confirm('You have unsaved changes to this vista. Discard them?')
}

function resolveUrl(url) {
  if (!url) return url
  return url.startsWith('http') ? url : `${apiUrl}${url}`
}

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
    const vista = await createVista(name, '')
    openVista(vista.id)
  } catch (err) {
    error.value = err.response?.data?.detail || err.message
  }
}

async function onDeleteVista(vista) {
  if (!window.confirm(`Delete vista "${vista.name}"? This cannot be undone.`)) return
  try {
    await removeVista(vista.id)
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
  fetchVistas()
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

.back-btn {
  background: transparent;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 0.25rem;
  border-radius: 4px;
  display: flex;
  align-items: center;
}

.back-btn:hover {
  background: var(--interactive-secondary);
  color: var(--text-primary);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.header-btn {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.5rem 0.9rem;
  border-radius: 8px;
  border: 1px solid var(--border-medium);
  background: var(--interactive-secondary);
  color: var(--text-primary);
  font-size: 0.85rem;
  cursor: pointer;
  transition: all 0.15s ease;
}

.header-btn:hover:not(:disabled) {
  border-color: var(--interactive-primary);
}

.header-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.header-btn.primary:not(:disabled) {
  background: var(--interactive-primary);
  border-color: var(--interactive-primary);
  color: white;
}

.header-btn.primary:not(:disabled):hover {
  background: var(--interactive-primaryHover);
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
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.gallery-header {
  display: flex;
  justify-content: flex-end;
}

.new-vista-btn {
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
}

.new-vista-btn:hover {
  border-style: solid;
  border-color: var(--interactive-primary);
  background: var(--interactive-secondary);
  color: var(--text-primary);
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

.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  color: var(--text-secondary);
}

.empty-state .mdi {
  font-size: 3rem;
  opacity: 0.5;
}

.vista-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 1.25rem;
}

.vista-card {
  position: relative;
  border: 1px solid var(--border-light);
  border-radius: 10px;
  overflow: hidden;
  cursor: pointer;
  background: rgba(26, 27, 58, 0.4);
  transition: all 0.2s ease;
}

.vista-card-delete {
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

.vista-card:hover .vista-card-delete {
  opacity: 1;
}

.vista-card-delete:hover {
  background: rgba(248, 113, 113, 0.2);
  color: var(--status-error, #f87171);
}

.vista-card:hover {
  border-color: var(--interactive-primary);
  transform: translateY(-2px);
}

.vista-card-thumb {
  aspect-ratio: 16 / 10;
  background: rgba(12, 13, 29, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.vista-card-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.vista-card-thumb .mdi {
  font-size: 2.5rem;
  color: var(--text-secondary);
  opacity: 0.5;
}

.vista-card-info {
  padding: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.vista-card-name {
  color: var(--text-primary);
  font-weight: 500;
}

.vista-card-desc {
  color: var(--text-secondary);
  font-size: 0.8rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.editor-view {
  flex: 1;
  overflow: hidden;
  display: flex;
}
</style>
