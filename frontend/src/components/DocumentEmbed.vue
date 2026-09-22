<template>
  <span class="document-embed" :class="{ interactive: canInteract }">
    <span v-if="loading" class="embed-state">
      <span class="mdi mdi-loading mdi-spin"></span> Loading {{ type }}…
    </span>
    <span v-else-if="error" class="embed-state error">
      <span class="mdi mdi-alert-circle-outline"></span> {{ type }}:{{ id }} — {{ error }}
    </span>
    <template v-else-if="doc">
      <!-- Same read-only canvases /screen uses, sized to the document's own
           aspect ratio so it reads like an inline image. -->
      <span
        class="embed-frame"
        :style="{ aspectRatio }"
        :title="canInteract ? `Open ${doc.name}` : doc.name"
        @click="openInModal"
      >
        <component :is="config.component" v-bind="canvasProps" @open-note="openNote" />
      </span>
      <span class="embed-bar">
        <span class="mdi" :class="config.icon"></span>
        <span class="embed-name">{{ doc.name }}</span>
        <button
          v-if="canInteract && hasImage"
          class="embed-btn"
          :class="{ sent }"
          title="Display on screen"
          @click.stop="sendToScreen"
        >
          <span class="mdi" :class="sent ? 'mdi-check' : 'mdi-monitor'"></span>
          <span>{{ sent ? 'Sent!' : 'Screen' }}</span>
        </button>
      </span>
    </template>
  </span>
</template>

<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import ChartCanvas from './ChartCanvas.vue'
import VistaCanvas from './VistaCanvas.vue'
import { fetchChart } from '@/api/charts'
import { fetchVista } from '@/api/vistas'
import { post } from '@/api/http'
import { apiUrl } from '@/config/env'
import { resolveUrl } from '@/utils/resolveUrl'
import { DOC_EMBED_ICONS } from '@/utils/inlineRefs'
import { useChartsModal } from '@/composables/useChartsModal'
import { useVistasModal } from '@/composables/useVistasModal'

const props = defineProps({
  type: { type: String, required: true }, // 'chart' | 'vista'
  id: { type: String, required: true },
  // Screen button + click-to-open, only for signed-in users (same gate as
  // the note's dice/song/image-screen wiring).
  canInteract: { type: Boolean, default: false }
})

// Everything that differs between a chart and a vista embed.
const TYPES = {
  chart: {
    component: ChartCanvas,
    fetch: fetchChart,
    modal: useChartsModal,
    imageKey: 'image_url',
    screen: (id) => post(`${apiUrl}/api/screen/chart`, { chart_id: id }),
    canvasProps: (doc) => ({ chart: doc, editable: false, zoomable: false })
  },
  vista: {
    component: VistaCanvas,
    fetch: fetchVista,
    modal: useVistasModal,
    imageKey: 'background_url',
    screen: (id) => post(`${apiUrl}/api/screen/vista`, { vista_id: id }),
    canvasProps: (doc) => ({ vista: doc, editable: false }),
    // VistaCanvas letterboxes every scene to a fixed 16:9 stage.
    aspectRatio: '16 / 9'
  }
}

const router = useRouter()
const config = computed(() => ({ ...TYPES[props.type], icon: DOC_EMBED_ICONS[props.type] }))
const doc = ref(null)
const loading = ref(true)
const error = ref(null)
const sent = ref(false)
const imageRatio = ref(null)
let sentTimeout = null

const hasImage = computed(() => !!doc.value?.[config.value.imageKey])
const canvasProps = computed(() => config.value.canvasProps(doc.value))
const aspectRatio = computed(() => config.value.aspectRatio || imageRatio.value || '16 / 9')

async function load() {
  loading.value = true
  error.value = null
  try {
    doc.value = await config.value.fetch(props.id)
    loadImageRatio()
  } catch (err) {
    error.value = err.response?.status === 404 ? 'not found' : (err.response?.data?.detail || err.message)
  } finally {
    loading.value = false
  }
}

// A chart's SVG is fit ("meet") to its map image, so match the frame to the
// image's proportions to avoid letterbox bars around it.
function loadImageRatio() {
  imageRatio.value = null
  const url = props.type === 'chart' && doc.value?.image_url
  if (!url) return
  const img = new Image()
  img.onload = () => { imageRatio.value = `${img.naturalWidth} / ${img.naturalHeight}` }
  img.src = resolveUrl(url)
}

watch(() => [props.type, props.id], load, { immediate: true })

function openInModal() {
  if (!props.canInteract) return
  config.value.modal().open(props.id)
}

function openNote(notePath) {
  router.push(`/note/${notePath.split('/').map(encodeURIComponent).join('/')}`)
}

async function sendToScreen() {
  try {
    await config.value.screen(props.id)
    sent.value = true
    clearTimeout(sentTimeout)
    sentTimeout = setTimeout(() => { sent.value = false }, 2000)
  } catch (err) {
    console.error(`Failed to send ${props.type} to screen:`, err)
  }
}

onBeforeUnmount(() => clearTimeout(sentTimeout))
</script>

<style scoped>
.document-embed {
  display: block;
  margin: 1rem 0;
  border: 1px solid rgba(138, 92, 245, 0.3);
  border-radius: 10px;
  overflow: hidden;
  background: rgba(5, 6, 20, 0.8);
}

.embed-frame {
  display: block;
  position: relative;
  width: 100%;
  max-height: 70vh;
}

.document-embed.interactive .embed-frame {
  cursor: pointer;
}

.embed-bar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  border-top: 1px solid rgba(138, 92, 245, 0.2);
  color: var(--text-secondary);
  font-size: 0.85rem;
}

.embed-bar > .mdi {
  color: #a78bfa;
}

.embed-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary, #f0f0ff);
}

.embed-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.25rem 0.6rem;
  border-radius: 6px;
  border: 1px solid rgba(138, 92, 245, 0.4);
  background: rgba(138, 92, 245, 0.15);
  color: #e0d4ff;
  font-size: 0.8rem;
  cursor: pointer;
  transition: all 0.15s ease;
}

.embed-btn:hover {
  background: rgba(138, 92, 245, 0.3);
}

.embed-btn.sent {
  border-color: rgba(52, 211, 153, 0.5);
  background: rgba(52, 211, 153, 0.15);
  color: #34d399;
}

.embed-state {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 1rem;
  color: var(--text-secondary);
  font-size: 0.9rem;
}

.embed-state.error {
  color: var(--status-error, #f87171);
}
</style>
