<template>
  <span class="document-embed" :class="{ interactive: canInteract }">
    <span v-if="locked" class="embed-state">
      <span class="mdi mdi-lock-outline"></span> Sign in to view this {{ type }}
    </span>
    <span v-else-if="loading" class="embed-loading" aria-busy="true">
      <span class="rk-skeleton embed-skeleton" :style="{ aspectRatio: config.aspectRatio || '16 / 9' }"></span>
      <span class="embed-bar">
        <span class="mdi" :class="config.icon"></span>
        <span class="embed-name muted">Loading {{ type }}…</span>
      </span>
    </span>
    <span v-else-if="error" class="embed-state error" role="alert">
      <span class="mdi mdi-alert-circle-outline"></span> {{ type }}:{{ id }}: {{ error }}
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
          type="button"
          class="rk-btn rk-btn--sm embed-btn"
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
  // Signed in: charts and vistas are behind login (notes aren't), so without
  // it this shows a placeholder instead of fetching. Also gates the screen
  // button + click-to-open (same as the note's dice/song/image-screen wiring).
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
const locked = ref(false)
const imageRatio = ref(null)
let sentTimeout = null

const hasImage = computed(() => !!doc.value?.[config.value.imageKey])
const canvasProps = computed(() => config.value.canvasProps(doc.value))
const aspectRatio = computed(() => config.value.aspectRatio || imageRatio.value || '16 / 9')

async function load() {
  doc.value = null
  error.value = null
  locked.value = !props.canInteract
  if (locked.value) {
    loading.value = false
    return
  }
  loading.value = true
  try {
    doc.value = await config.value.fetch(props.id)
    loadImageRatio()
  } catch (err) {
    if (err.response?.status === 401) locked.value = true
    else error.value = err.response?.status === 404 ? 'not found' : (err.response?.data?.detail || err.message)
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

watch(() => [props.type, props.id, props.canInteract], load, { immediate: true })

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
  margin: var(--space-4) 0;
  border: 1px solid var(--accent-a30);
  border-radius: var(--radius-lg);
  overflow: hidden;
  background: var(--surface-sunken);
  transition: border-color var(--duration-fast) var(--ease-out);
}

.document-embed.interactive:hover {
  border-color: var(--accent-a45);
}

.embed-frame {
  display: block;
  position: relative;
  width: 100%;
  max-height: 70dvh;
}

.document-embed.interactive .embed-frame {
  cursor: pointer;
}

/* Placeholder at the scene's own proportions so the note doesn't jump
   when the canvas arrives. */
.embed-loading {
  display: block;
}

.embed-skeleton {
  display: block;
  width: 100%;
  max-height: 70dvh;
}

.embed-bar {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-top: 1px solid var(--accent-a20);
  color: var(--text-secondary);
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
}

.embed-bar > .mdi {
  color: var(--accent-hover);
}

.embed-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
}

.embed-name.muted {
  color: var(--text-muted);
}

.embed-btn {
  border-color: var(--accent-a45);
  background: var(--accent-a12);
  color: var(--accent-soft);
}

.embed-btn:hover:not(:disabled) {
  background: var(--accent-a30);
}

.embed-btn.sent,
.embed-btn.sent:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--status-success) 50%, transparent);
  background: var(--status-success-bg);
  color: var(--status-success);
}

.embed-state {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-4);
  color: var(--text-secondary);
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
}

.embed-state .mdi {
  font-size: 1.1rem;
  color: var(--text-muted);
}

.embed-state.error {
  color: var(--status-error);
  background: var(--status-error-bg);
}

.embed-state.error .mdi {
  color: inherit;
}
</style>
