<template>
  <div class="battlemap-canvas">
    <!-- What to do about it is the owner's (the `empty-actions` slot). -->
    <CanvasEmptyState v-if="!imageUrl">
      This map has no image yet.
      <template #actions><slot name="empty-actions" /></template>
    </CanvasEmptyState>

    <div v-else class="canvas-viewport">
      <svg
        v-if="naturalWidth"
        ref="svgRef"
        class="canvas-svg"
        :class="`tool-${tool}`"
        :viewBox="`0 0 ${naturalWidth} ${naturalHeight}`"
        preserveAspectRatio="xMidYMid meet"
        @pointerdown="onBackgroundDown"
      >
        <g ref="groupRef">
          <image :href="resolvedImageUrl" x="0" y="0" :width="naturalWidth" :height="naturalHeight" preserveAspectRatio="none" />

          <template v-if="grid.type === 'square' && grid.visible">
            <defs>
              <pattern :id="`grid-${uid}`" :x="grid.offset_x" :y="grid.offset_y" :width="grid.size" :height="grid.size" patternUnits="userSpaceOnUse">
                <path :d="`M ${grid.size} 0 L 0 0 L 0 ${grid.size}`" fill="none" :stroke="grid.color" :stroke-width="lineWidth" />
              </pattern>
            </defs>
            <rect class="grid-rect" x="0" y="0" :width="naturalWidth" :height="naturalHeight" :fill="`url(#grid-${uid})`" :opacity="grid.opacity" />
          </template>

          <g
            v-for="token in tokens"
            :key="token.id"
            class="token"
            :class="{ selected: token.id === selectedId, hidden: token.hidden, dragging: token.id === draggingId }"
            :transform="`translate(${center(token).x}, ${center(token).y})`"
            @pointerdown.stop="onTokenDown(token, $event)"
            @mousedown.stop.prevent
            @touchstart.stop
          >
            <title>{{ token.name }}</title>
            <clipPath :id="`clip-${uid}-${token.id}`"><circle :r="radius(token)" /></clipPath>
            <circle class="token-body" :r="radius(token)" :fill="token.color || DEFAULT_COLOR" />
            <!-- The art turns with the token (which way it faces); its name and bars don't. -->
            <image
              v-if="token.image_url"
              :href="resolveUrl(token.image_url)"
              :x="-radius(token)" :y="-radius(token)" :width="radius(token) * 2" :height="radius(token) * 2"
              :clip-path="`url(#clip-${uid}-${token.id})`"
              :transform="token.rotation ? `rotate(${token.rotation})` : null"
              preserveAspectRatio="xMidYMid slice"
            />
            <text v-else class="token-initials" :font-size="radius(token) * 0.9" text-anchor="middle" dominant-baseline="central">{{ initials(token.name) }}</text>
            <circle class="token-ring" :r="radius(token)" fill="none" :stroke-width="ringWidth" />

            <g v-for="(meter, i) in token.meters || []" :key="meter.name" class="meter" :transform="`translate(${-radius(token)}, ${radius(token) + meterGap + i * (meterHeight + 2)})`">
              <rect class="meter-back" :width="radius(token) * 2" :height="meterHeight" :rx="meterHeight / 2" />
              <rect class="meter-fill" :width="radius(token) * 2 * meterFill(meter)" :height="meterHeight" :rx="meterHeight / 2" :fill="meter.color || DEFAULT_METER" />
              <title>{{ meter.name }} {{ meter.current }} / {{ meter.max }}</title>
            </g>

            <text v-if="token.name" class="token-label" :font-size="labelSize" :y="-radius(token) - labelSize * 0.35" text-anchor="middle">{{ token.name }}</text>
          </g>

          <g v-if="ruler" class="ruler" pointer-events="none">
            <line :x1="ruler.from.x" :y1="ruler.from.y" :x2="ruler.to.x" :y2="ruler.to.y" :stroke-width="ringWidth * 1.5" />
            <circle :cx="ruler.from.x" :cy="ruler.from.y" :r="ringWidth * 2.5" />
            <circle :cx="ruler.to.x" :cy="ruler.to.y" :r="ringWidth * 2.5" />
            <g :transform="`translate(${(ruler.from.x + ruler.to.x) / 2}, ${(ruler.from.y + ruler.to.y) / 2})`">
              <rect class="ruler-back" :x="-rulerSize * 2.6" :y="-rulerSize * 0.9" :width="rulerSize * 5.2" :height="rulerSize * 1.8" :rx="rulerSize * 0.3" />
              <text class="ruler-label" :font-size="rulerSize" text-anchor="middle" dominant-baseline="central">{{ ruler.label }}</text>
            </g>
          </g>
        </g>
      </svg>
      <CanvasEmptyState v-else-if="imageStatus === 'error'" icon="mdi-image-broken-variant" error>
        The map image could not be loaded. It may have been deleted from the Observatory.
      </CanvasEmptyState>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useMapViewport } from '@/composables/useMapViewport'
import CanvasEmptyState from './CanvasEmptyState.vue'
import { usePointerDrag } from '@/composables/usePointerDrag'
import { resolveUrl } from '@/utils/resolveUrl'
import {
  cellCenter, initials, measure, meterFill, snapPosition, toCells, toPixels, tokenCenter
} from '@/utils/battlemapGeometry'

// A battlemap drawn: the image, its grid and the tokens on it. It changes
// nothing itself: moving a token is reported (`moving` while it is dragged,
// `move` once dropped) for whoever owns the map to apply, and the screen's
// copy is just this with nothing editable. `tokens` carry what to draw:
// { id, name, x, y, size, rotation (degrees, clockwise), image_url, color,
// hidden, meters: [{ name, current, max, min, color }] }.
const props = defineProps({
  imageUrl: { type: String, default: null },
  grid: { type: Object, required: true },
  tokens: { type: Array, default: () => [] },
  selectedId: { type: String, default: null },
  // 'select': drag tokens, pan the map. 'ruler': measure a distance.
  tool: { type: String, default: 'select' },
  editable: { type: Boolean, default: false },
  // false on /screen: a projection to look at, not to pan around in.
  zoomable: { type: Boolean, default: true },
  resetKey: { type: String, default: null }
})

const emit = defineEmits(['select', 'moving', 'move'])

const DEFAULT_COLOR = '#6d4fc2'
const DEFAULT_METER = '#4ade80'
// How far a press may wander, in pixels of the screen (not of the map: on a
// big map shown small, a few pixels of the map are less than a finger's
// wobble), and still be a tap that only selects.
const DRAG_THRESHOLD_PX = 4

const uid = Math.random().toString(36).slice(2, 8)
const svgRef = ref(null)
const groupRef = ref(null)

const resolvedImageUrl = computed(() => resolveUrl(props.imageUrl))
const { naturalWidth, naturalHeight, imageStatus, pointer } = useMapViewport({
  svgRef,
  groupRef,
  imageUrl: () => props.imageUrl,
  zoomable: () => props.zoomable,
  canPan: () => props.tool === 'select',
  resetKey: () => props.resetKey
})

// Sizes follow the cell, so a token keeps its look at any grid size.
const cell = computed(() => props.grid.size)
const lineWidth = computed(() => Math.max(1, cell.value * 0.025))
const ringWidth = computed(() => Math.max(2, cell.value * 0.05))
const labelSize = computed(() => Math.max(10, cell.value * 0.24))
const rulerSize = computed(() => Math.max(14, cell.value * 0.34))
const meterHeight = computed(() => Math.max(4, cell.value * 0.1))
const meterGap = computed(() => Math.max(3, cell.value * 0.06))
const radius = (token) => Math.max(4, ((token.size ?? 1) * cell.value) / 2 - ringWidth.value)

// While a token is dragged (and a moment after it is dropped, until the
// document catches up) it is drawn where the pointer put it, not where the
// document still has it.
const override = ref(null)
const draggingId = ref(null)
let releaseTimer = null

const placed = (token) => (override.value?.id === token.id ? { ...token, x: override.value.x, y: override.value.y } : token)
const center = (token) => tokenCenter(props.grid, placed(token))

watch(() => props.tokens, (tokens) => {
  const held = override.value
  if (!held || tokenDrag.active()) return
  const token = tokens.find((t) => t.id === held.id)
  if (!token || (token.x === held.x && token.y === held.y)) override.value = null
}, { deep: true })

// A token follows the pointer that grabbed it (the primary button, one
// pointer); where it is let go is where it goes. If the browser cancels the
// gesture it goes back where it was, and so does everyone else's copy, which
// was following it as it moved.
const tokenDrag = usePointerDrag({
  toPoint: pointer,
  thresholdPx: DRAG_THRESHOLD_PX,
  onMove(point, _event, drag) {
    const cells = toCells(props.grid, point.x - drag.grab.x, point.y - drag.grab.y)
    const position = snapPosition(props.grid, cells.x, cells.y)
    override.value = { id: drag.id, ...position }
    emit('moving', drag.id, position)
  },
  onEnd(drag, { moved }) {
    draggingId.value = null
    if (!moved || !override.value) {
      override.value = null
      return
    }
    const { x, y } = override.value
    emit('move', drag.id, { x, y })
    // Let go of the pointer's position once the document has had time to agree.
    releaseTimer = setTimeout(() => { override.value = null }, 1000)
  },
  onCancel(drag, { moved }) {
    draggingId.value = null
    override.value = null
    if (moved) emit('move', drag.id, drag.from)
  }
})

function onTokenDown(token, event) {
  emit('select', token.id)
  if (!props.editable || props.tool !== 'select') return
  const point = pointer(event)
  if (!point) return
  const topLeft = toPixels(props.grid, token.x, token.y)
  const grab = { x: point.x - topLeft.x, y: point.y - topLeft.y }
  if (!tokenDrag.start(event, { id: token.id, grab, from: { x: token.x, y: token.y } })) return
  clearTimeout(releaseTimer)
  draggingId.value = token.id
}

// ── ruler ──────────────────────────────────────────────────────────────────

const ruler = ref(null)

const measuring = usePointerDrag({
  toPoint: (event) => rulerPoint(event),
  onMove(to) {
    ruler.value = { from: ruler.value.from, to, label: measure(props.grid, ruler.value.from, to).label }
  }
})

watch(() => props.tool, () => { ruler.value = null })

function rulerPoint(event) {
  const point = pointer(event)
  return point && cellCenter(props.grid, point.x, point.y)
}

function onBackgroundDown(event) {
  if (props.tool === 'ruler') {
    if (event.button) return
    const from = rulerPoint(event)
    if (!from || !measuring.start(event)) return
    ruler.value = { from, to: from, label: measure(props.grid, from, from).label }
  } else {
    emit('select', null)
  }
}

onBeforeUnmount(() => clearTimeout(releaseTimer))
</script>

<style scoped>
.battlemap-canvas {
  /* Positioned content is measured in px, not in the type scale. */
  line-height: normal;
  width: 100%;
  height: 100%;
  position: relative;
  background: radial-gradient(ellipse at 30% 40%, rgba(20, 15, 60, 0.9) 0%, rgba(5, 6, 20, 1) 60%, rgba(2, 3, 12, 1) 100%);
}

.canvas-viewport {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  user-select: none;
  -webkit-user-select: none;
}

.canvas-svg {
  width: 100%;
  height: 100%;
  display: block;
  /* A finger drag must move a token or pan the map, not scroll the page. */
  touch-action: none;
}

.canvas-svg.tool-select {
  cursor: grab;
}

.canvas-svg.tool-ruler {
  cursor: crosshair;
}

.grid-rect {
  pointer-events: none;
}

.token {
  cursor: pointer;
}

.token.dragging {
  cursor: grabbing;
}

.canvas-svg.tool-ruler .token {
  pointer-events: none;
}

.token-body {
  stroke: rgba(0, 0, 0, 0.5);
  stroke-width: 1;
}

.token-ring {
  stroke: rgba(255, 255, 255, 0.85);
  transition: stroke var(--duration-fast) var(--ease-out);
}

.token.selected .token-ring {
  stroke: var(--accent-soft);
}

.token.selected .token-body {
  filter: drop-shadow(0 0 6px rgba(167, 139, 250, 0.9));
}

/* A hidden token is one only the table sees: dimmed here, absent from screens. */
.token.hidden {
  opacity: 0.45;
}

.token.hidden .token-ring {
  stroke-dasharray: 6 4;
}

.token-initials {
  fill: #fff;
  font-weight: 700;
  pointer-events: none;
}

.token-label {
  fill: #fff;
  font-weight: 600;
  paint-order: stroke;
  stroke: rgba(0, 0, 0, 0.85);
  stroke-width: 3px;
  stroke-linejoin: round;
  pointer-events: none;
}

.meter-back {
  fill: rgba(0, 0, 0, 0.65);
}

.meter-fill {
  transition: width var(--duration-base) var(--ease-out);
}

.ruler line {
  stroke: #fbbf24;
  stroke-linecap: round;
}

.ruler circle {
  fill: #fbbf24;
}

.ruler-back {
  fill: rgba(12, 13, 29, 0.9);
  stroke: #fbbf24;
  stroke-width: 1.5;
}

.ruler-label {
  fill: #fff;
  font-weight: 700;
}
</style>
