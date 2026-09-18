<template>
  <div v-if="isOpen" class="modal-overlay" @click.self="closeModal">
    <div class="modal-content charts-modal-content">
      <div class="modal-header">
        <h2>
          <button v-if="view === 'editor'" class="back-btn" title="Back to charts" @click="backToGallery">
            <span class="mdi mdi-arrow-left"></span>
          </button>
          <span class="mdi mdi-map-marker-radius"></span>
          {{ view === 'editor' && activeChart ? activeChart.name : 'Charts' }}
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
            :disabled="!activeChart?.image_url || sendingToScreen"
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

      <div class="modal-body charts-body">
        <!-- Gallery -->
        <div v-if="view === 'gallery'" class="gallery-view">
          <div v-if="user" class="gallery-header">
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
            <button v-else class="new-chart-btn" @click="startNewChart">
              <span class="mdi mdi-plus"></span> New chart
            </button>
          </div>

          <div v-if="loading" class="hint-state">Loading charts...</div>
          <div v-else-if="error" class="hint-state error">{{ error }}</div>
          <div v-else-if="!charts.length" class="empty-state">
            <span class="mdi mdi-compass-outline"></span>
            <p>No charts yet.</p>
            <button v-if="user" class="new-chart-btn" @click="startNewChart">
              <span class="mdi mdi-plus"></span> New chart
            </button>
          </div>
          <div v-else class="chart-grid">
            <div v-for="c in charts" :key="c.id" class="chart-card" @click="openChart(c.id)">
              <div class="chart-card-thumb">
                <img v-if="c.image_url" :src="resolveUrl(c.image_url)" :alt="c.name" />
                <span v-else class="mdi mdi-map-outline"></span>
              </div>
              <div class="chart-card-info">
                <span class="chart-card-name">{{ c.name }}</span>
                <span v-if="c.description" class="chart-card-desc">{{ c.description }}</span>
              </div>
            </div>
          </div>
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
              @upload-map-image="onUploadMapImage"
              @upload-pin-icon="onUploadPinIcon"
              @open-note="onOpenNote"
            />
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import ChartCanvas from './ChartCanvas.vue'
import { useAuth } from '@/composables/useAuth'
import { useChartsModal } from '@/composables/useChartsModal'
import { useCharts } from '@/composables/useCharts'
import { post } from '@/api/http'
import { apiUrl } from '@/config/env'
import * as chartsApi from '@/api/charts'

defineProps({
  notes: { type: Array, default: () => [] }
})

const router = useRouter()
const { isOpen, close } = useChartsModal()
const { user } = useAuth()
const { charts, loading, error, fetchCharts, createChart } = useCharts()

const view = ref('gallery')
const showNewChartInput = ref(false)
const newChartName = ref('')
const newChartInputRef = ref(null)

const activeChart = ref(null)
const loadingChart = ref(false)
const sendingToScreen = ref(false)
const hasUnsavedChanges = ref(false)
const saving = ref(false)

watch(isOpen, (open) => {
  if (open && view.value === 'gallery') {
    fetchCharts()
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
  return !hasUnsavedChanges.value || window.confirm('You have unsaved changes to this chart. Discard them?')
}

function resolveUrl(url) {
  if (!url) return url
  return url.startsWith('http') ? url : `${apiUrl}${url}`
}

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
    const chart = await createChart(name, '')
    openChart(chart.id)
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
  fetchCharts()
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

async function onUploadMapImage(file) {
  if (!activeChart.value) return
  try {
    const updated = await chartsApi.uploadChartImage(activeChart.value.id, file)
    activeChart.value.image_url = updated.image_url
  } catch (err) {
    console.error('Failed to upload map image:', err)
  }
}

async function onUploadPinIcon({ pinId, file }) {
  if (!activeChart.value) return
  try {
    const result = await chartsApi.uploadPinIcon(activeChart.value.id, pinId, file)
    const pin = activeChart.value.pins.find(p => p.id === pinId)
    if (pin) {
      pin.icon_url = result.icon_url
      hasUnsavedChanges.value = true
    }
  } catch (err) {
    console.error('Failed to upload pin icon:', err)
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
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.gallery-header {
  display: flex;
  justify-content: flex-end;
}

.new-chart-btn {
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

.new-chart-btn:hover {
  border-style: solid;
  border-color: var(--interactive-primary);
  background: var(--interactive-secondary);
  color: var(--text-primary);
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

.chart-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 1.25rem;
}

.chart-card {
  border: 1px solid var(--border-light);
  border-radius: 10px;
  overflow: hidden;
  cursor: pointer;
  background: rgba(26, 27, 58, 0.4);
  transition: all 0.2s ease;
}

.chart-card:hover {
  border-color: var(--interactive-primary);
  transform: translateY(-2px);
}

.chart-card-thumb {
  aspect-ratio: 16 / 10;
  background: rgba(12, 13, 29, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.chart-card-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.chart-card-thumb .mdi {
  font-size: 2.5rem;
  color: var(--text-secondary);
  opacity: 0.5;
}

.chart-card-info {
  padding: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.chart-card-name {
  color: var(--text-primary);
  font-weight: 500;
}

.chart-card-desc {
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
