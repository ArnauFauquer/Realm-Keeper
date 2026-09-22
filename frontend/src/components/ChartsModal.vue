<template>
  <div v-if="isOpen" class="modal-overlay" @click.self="closeModal">
    <div class="modal-content charts-modal-content">
      <DocumentModalHeader
        :view="view"
        icon="mdi-map-marker-radius"
        gallery-title="Charts"
        :item-title="activeChart?.name"
        :can-edit="!!user"
        :has-unsaved-changes="hasUnsavedChanges"
        :saving="saving"
        :can-send-to-screen="!!activeChart?.image_url"
        :sending-to-screen="sendingToScreen"
        :copy-text="activeChart && docRefMarkdown('chart', activeChart.id)"
        @back="backToGallery"
        @save="saveNow"
        @send-to-screen="sendToScreen"
        @close="closeModal"
      />

      <div class="modal-body charts-body">
        <!-- Gallery -->
        <div v-if="view === 'gallery'" class="gallery-view">
          <FolderGallery
            :folders="folders"
            :items="charts"
            :item-key="(c) => c.id"
            :item-copy-text="(c) => docRefMarkdown('chart', c.id)"
            :current-path="currentPath"
            :loading="loading"
            :error="error"
            :can-edit="!!user"
            root-label="Charts"
            root-icon="mdi-map-marker-radius"
            loading-text="Loading charts..."
            empty-icon="mdi-compass-outline"
            empty-text="No charts yet."
            @navigate="goToPath"
            @enter-folder="enterFolder"
            @open-item="(c) => openChart(c.id)"
            @delete-folder="onDeleteFolder"
            @delete-item="onDeleteChart"
            @create-folder="onCreateFolder"
            @rename-folder="onRenameFolder"
            @rename-item="onRenameChart"
            @move="onMove"
          >
            <template #actions>
              <div v-if="showNewChartInput" class="new-chart-form">
                <input
                  ref="newChartInputRef"
                  v-model="newChartName"
                  placeholder="Chart name"
                  @keyup.enter="submitNewChart"
                  @keyup.esc="showNewChartInput = false"
                />
                <button class="icon-btn" @click="submitNewChart"><span class="mdi mdi-check"></span></button>
                <button class="icon-btn" @click="showNewChartInput = false"><span class="mdi mdi-close"></span></button>
              </div>
              <button v-else class="gallery-action-btn" @click="startNewChart">
                <span class="mdi mdi-plus"></span> New chart
              </button>
            </template>
            <template #empty-actions>
              <button v-if="user" class="gallery-action-btn" @click="startNewChart">
                <span class="mdi mdi-plus"></span> New chart
              </button>
            </template>
            <template #thumb="{ item }">
              <img v-if="item.image_url" :src="resolveUrl(item.image_url)" :alt="item.name" />
              <span v-else class="mdi mdi-map-outline"></span>
            </template>
          </FolderGallery>
        </div>

        <!-- Editor / viewer -->
        <div v-else-if="view === 'editor'" class="editor-view">
          <div v-if="loadingChart" class="hint-state">Loading chart...</div>
          <template v-else-if="activeChart">
            <ChartCanvas
              :chart="activeChart"
              :editable="!!user"
              :notes="notes"
              @change="onCanvasChange"
              @set-map-image="onSetMapImage"
              @open-note="onOpenNote"
            />
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import ChartCanvas from './ChartCanvas.vue'
import FolderGallery from './FolderGallery.vue'
import DocumentModalHeader from './DocumentModalHeader.vue'
import { useAuth } from '@/composables/useAuth'
import { useChartsModal } from '@/composables/useChartsModal'
import { useCharts } from '@/composables/useCharts'
import { useUnsavedChangesGuard } from '@/composables/useUnsavedChangesGuard'
import { post } from '@/api/http'
import { apiUrl } from '@/config/env'
import { resolveUrl } from '@/utils/resolveUrl'
import { docRefMarkdown } from '@/utils/inlineRefs'
import * as chartsApi from '@/api/charts'

defineProps({
  notes: { type: Array, default: () => [] }
})

const router = useRouter()
const { isOpen, targetId, close } = useChartsModal()
const { user } = useAuth()
const {
  folders, charts, loading, error,
  fetchTree, createChart, removeChart, moveChart, renameChart,
  createFolder, removeFolder, renameFolder, moveFolder
} = useCharts()

const view = ref('gallery')
const currentPath = ref('')
const showNewChartInput = ref(false)
const newChartName = ref('')
const newChartInputRef = ref(null)

const activeChart = ref(null)
const loadingChart = ref(false)
const sendingToScreen = ref(false)
const hasUnsavedChanges = ref(false)
const saving = ref(false)

watch(isOpen, (open) => {
  if (open && targetId.value) {
    // Opened from a chart embedded in a note: skip the gallery.
    openChart(targetId.value)
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
      await moveChart(currentPath.value, dragItem.item.id, destPath)
    }
  } catch (err) {
    error.value = err.response?.data?.detail || err.message
  }
}

const { confirmDiscard } = useUnsavedChangesGuard(
  hasUnsavedChanges, 'You have unsaved changes to this chart. Discard them?'
)

function closeModal() {
  if (!confirmDiscard()) return
  close()
  view.value = 'gallery'
  activeChart.value = null
  hasUnsavedChanges.value = false
}

function startNewChart() {
  showNewChartInput.value = true
  nextTick(() => newChartInputRef.value?.focus())
}

async function submitNewChart() {
  const name = newChartName.value.trim()
  if (!name) return
  newChartName.value = ''
  showNewChartInput.value = false
  try {
    const chart = await createChart(name, '', currentPath.value)
    openChart(chart.id)
  } catch (err) {
    error.value = err.response?.data?.detail || err.message
  }
}

async function onDeleteChart(chart) {
  if (!window.confirm(`Delete chart "${chart.name}"? This cannot be undone.`)) return
  try {
    await removeChart(currentPath.value, chart.id)
  } catch (err) {
    error.value = err.response?.data?.detail || err.message
  }
}

async function onRenameChart(chart, name) {
  try {
    await renameChart(currentPath.value, chart.id, name)
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

async function openChart(chartId) {
  view.value = 'editor'
  loadingChart.value = true
  try {
    activeChart.value = await chartsApi.fetchChart(chartId)
    hasUnsavedChanges.value = false
  } catch (err) {
    error.value = err.response?.data?.detail || err.message
    view.value = 'gallery'
  } finally {
    loadingChart.value = false
  }
}

function backToGallery() {
  if (!confirmDiscard()) return
  view.value = 'gallery'
  activeChart.value = null
  hasUnsavedChanges.value = false
  fetchTree(currentPath.value)
}

async function saveNow() {
  const chart = activeChart.value
  if (!chart || saving.value) return
  saving.value = true
  try {
    await chartsApi.saveChart(chart.id, {
      name: chart.name,
      description: chart.description,
      pins: chart.pins,
      paths: chart.paths,
      annotations: chart.annotations
    })
    hasUnsavedChanges.value = false
  } catch (err) {
    console.error('Failed to save chart:', err)
  } finally {
    saving.value = false
  }
}

function onCanvasChange() {
  hasUnsavedChanges.value = true
}

async function onSetMapImage(url) {
  if (!activeChart.value) return
  try {
    const updated = await chartsApi.setChartImage(activeChart.value.id, url)
    activeChart.value.image_url = updated.image_url
  } catch (err) {
    console.error('Failed to set map image:', err)
  }
}

async function sendToScreen() {
  if (!activeChart.value) return
  try {
    await post(`${apiUrl}/api/screen/chart`, { chart_id: activeChart.value.id })
    sendingToScreen.value = true
    setTimeout(() => { sendingToScreen.value = false }, 2000)
  } catch (err) {
    console.error('Failed to send chart to screen:', err)
  }
}

function onOpenNote(notePath) {
  closeModal()
  router.push(`/note/${notePath.split('/').map(encodeURIComponent).join('/')}`)
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

.modal-content.charts-modal-content {
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

.modal-body.charts-body {
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

.new-chart-form {
  display: flex;
  gap: 0.4rem;
}

.new-chart-form input {
  background: rgba(26, 27, 58, 0.6);
  border: 1px solid var(--border-light);
  border-radius: 6px;
  padding: 0.5rem 0.7rem;
  color: var(--text-primary);
}

.new-chart-form input:focus {
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
