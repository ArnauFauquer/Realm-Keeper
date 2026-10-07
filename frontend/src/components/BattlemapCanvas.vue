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
        :viewBox="viewBox"
        preserveAspectRatio="xMidYMid meet"
        @pointerdown="onBackgroundDown"
        @dblclick="onBackgroundDoubleClick"
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

          <!-- Areas, under the tokens. An area catches the pointer by its
               outline and origin, so the map can still be panned through it;
               once selected, by its inside too (to move it), and its reach
               handle sizes and turns it. -->
          <g
            v-for="area in shownAreas"
            :key="area.id"
            class="area"
            :class="{ selected: area.id === selectedAreaId, hidden: area.hidden, preview: area.preview }"
            :style="{ '--area': area.color || DEFAULT_AREA_COLOR }"
          >
            <path
              class="area-fill"
              :d="areaPath(grid, area)"
              @pointerdown.stop="onAreaDown(area, $event)"
              @mousedown.stop.prevent
              @touchstart.stop
            />
            <path class="area-outline" :d="areaPath(grid, area)" :stroke-width="lineWidth * 2" />
            <!-- An outline wide enough to hit with a finger. -->
            <path
              class="area-hit"
              :d="areaPath(grid, area)"
              :stroke-width="Math.max(12, cell * 0.3)"
              @pointerdown.stop="onAreaDown(area, $event)"
              @mousedown.stop.prevent
              @touchstart.stop
            />
            <circle
              v-if="editable"
              class="area-handle"
              :cx="toPixels(grid, area.x, area.y).x"
              :cy="toPixels(grid, area.x, area.y).y"
              :r="ringWidth * (area.id === selectedAreaId ? 3 : 2)"
              @pointerdown.stop="onAreaDown(area, $event)"
              @mousedown.stop.prevent
              @touchstart.stop
            />
            <circle
              v-if="editable && area.id === selectedAreaId"
              class="area-reach"
              :cx="areaReachPoint(grid, area).x"
              :cy="areaReachPoint(grid, area).y"
              :r="ringWidth * 3"
              @pointerdown.stop="onReachDown(area, $event)"
              @mousedown.stop.prevent
              @touchstart.stop
            >
              <title>Drag to resize{{ area.shape === 'cone' || area.shape === 'line' ? ' and turn' : '' }}</title>
            </circle>
            <text
              class="area-label"
              :x="areaLabelPoint(grid, area).x"
              :y="areaLabelPoint(grid, area).y"
              :font-size="labelSize"
              text-anchor="middle"
              dominant-baseline="central"
            >{{ area.label ? `${area.label} · ` : '' }}{{ areaMeasure(grid, area) }}</text>
          </g>

          <BattlemapToken
            v-for="token in tokens"
            :key="token.id"
            :token="token"
            :cell="grid.size"
            :clip-id="`clip-${uid}-${token.id}`"
            :selected="token.id === selectedId"
            :dragging="token.id === draggingId"
            :transform="`translate(${center(token).x}, ${center(token).y})`"
            @pointerdown.stop="onTokenDown(token, $event)"
            @mousedown.stop.prevent
            @touchstart.stop
            @dblclick.stop="emit('open', token.id)"
          />

          <!-- Measuring: the ruler, or the path a token is being moved along,
               its ghost at the end. -->
          <template v-if="measuring">
            <MeasurePath :grid="grid" :points="[...measuring.points, measuring.current]" />
            <BattlemapToken
              v-if="ghost"
              :token="ghost"
              :cell="grid.size"
              :clip-id="`ghost-${uid}`"
              ghost
              :transform="`translate(${measuring.current.x}, ${measuring.current.y})`"
            />
          </template>

          <BattlemapSignals v-if="signals" :layer="signals" :grid="grid" :tokens="tokens" />
        </g>
      </svg>
      <CanvasEmptyState v-else-if="imageStatus === 'error'" icon="mdi-image-broken-variant" error>
        The map image could not be loaded. It may have been deleted from the Observatory.
      </CanvasEmptyState>
      <!-- Zoom for whoever has no wheel or pinch to hand (a trackpad, a mouse
           in the other hand). -->
      <div v-if="naturalWidth && zoomable" class="zoom" role="group" aria-label="Zoom">
        <button type="button" class="rk-icon-btn rk-icon-btn--sm" aria-label="Zoom out" title="Zoom out" @click="zoomBy(1 / ZOOM_STEP)">
          <span class="mdi mdi-minus"></span>
        </button>
        <button type="button" class="rk-icon-btn rk-icon-btn--sm" aria-label="Fit the map" title="Fit the map" @click="fit">
          <span class="mdi mdi-fit-to-screen-outline"></span>
        </button>
        <button type="button" class="rk-icon-btn rk-icon-btn--sm" aria-label="Zoom in" title="Zoom in" @click="zoomBy(ZOOM_STEP)">
          <span class="mdi mdi-plus"></span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useMapViewport } from '@/composables/useMapViewport'
import CanvasEmptyState from './CanvasEmptyState.vue'
import BattlemapSignals from './BattlemapSignals.vue'
import BattlemapToken from './BattlemapToken.vue'
import MeasurePath from './MeasurePath.vue'
import { usePointerDrag } from '@/composables/usePointerDrag'
import { useTokenTravel } from '@/composables/useTokenTravel'
import { resolveUrl } from '@/utils/resolveUrl'
import {
  areaFromDrag, areaLabelPoint, areaMeasure, areaPath, areaReachPoint, cellCenter, snapPosition, toCells, toPixels, tokenCenter
} from '@/utils/battlemapGeometry'

// A battlemap drawn: the image, its grid, its areas and the tokens on it. It
// changes nothing itself: what is done on it is reported for whoever owns the
// map to apply, and the screen's copy is just this with nothing editable.
// `tokens` carry what to draw: { id, name, x, y, size, rotation (degrees,
// clockwise), image_url, image_scale, image_x, image_y, color, hidden,
// meters: [{ name, current, max, min, color }] }; `areas` are the map's
// (backend models/battlemap.py Area).
//
// Moving a token or measuring follows a path: Space (or a second finger)
// adds a turn where the pointer is, Backspace takes the last one back. A
// token stays where it is while it is dragged, its ghost following the
// pointer with the distance; it moves when let go of.
const props = defineProps({
  imageUrl: { type: String, default: null },
  grid: { type: Object, required: true },
  tokens: { type: Array, default: () => [] },
  areas: { type: Array, default: () => [] },
  selectedId: { type: String, default: null },
  selectedAreaId: { type: String, default: null },
  // 'select': drag tokens and areas, pan the map. 'ruler': measure a path.
  // 'pointer': a tap pings, a drag is the laser pointer. 'area': drag out
  // an area of `areaShape`.
  tool: { type: String, default: 'select' },
  areaShape: { type: String, default: 'circle' },
  editable: { type: Boolean, default: false },
  // false on /screen: a projection to look at, not to pan around in.
  zoomable: { type: Boolean, default: true },
  resetKey: { type: String, default: null },
  // What is pointed at on the map, drawn over it (a layer of utils/mapSignals.js).
  signals: { type: Object, default: null },
  // On /screen: the part of the map to frame ({ x, y, width, height } in the
  // image's pixels), as the GM who is live with it sees it; null for all of it.
  view: { type: Object, default: null }
})

// `move` (a token let go of: id, { x, y }), `select` (a token, or null),
// `open` (a token double-clicked: show whoever it stands for), `ping` (a
// point tapped with the pointer, or the map double-clicked), `point` (the
// pointer dragged there), `release` (let go of), `measure` ({ points, token,
// end }: the path being measured or moved along, for everyone to see),
// `select-area`, `move-area` (id, { x, y }), `reshape-area` (id, { size,
// angle }), `add-area` (an area drawn) and `view` (the part of the map in
// view once zoomed or panned, in the image's pixels, or null for all of it).
// Points are in cells.
const emit = defineEmits([
  'select', 'move', 'open', 'ping', 'point', 'release', 'measure', 'select-area', 'move-area', 'reshape-area', 'add-area', 'view'
])

const DEFAULT_AREA_COLOR = '#f97316'
// How far a press may wander, in pixels of the screen (not of the map: on a
// big map shown small, a few pixels of the map are less than a finger's
// wobble), and still be a tap that only selects.
const DRAG_THRESHOLD_PX = 4

const uid = Math.random().toString(36).slice(2, 8)
const svgRef = ref(null)
const groupRef = ref(null)

const resolvedImageUrl = computed(() => resolveUrl(props.imageUrl))
const ZOOM_STEP = 1.4
const { naturalWidth, naturalHeight, imageStatus, pointer, fit, zoomBy } = useMapViewport({
  svgRef,
  groupRef,
  imageUrl: () => props.imageUrl,
  zoomable: () => props.zoomable,
  canPan: () => props.tool === 'select',
  resetKey: () => props.resetKey,
  onView: (rect) => emit('view', rect && withinImage(rect))
})

// The part of the image in view: past its edges there is nothing to frame.
// All of it is null.
function withinImage({ x, y, width, height }) {
  const w = naturalWidth.value
  const h = naturalHeight.value
  const left = Math.max(0, x)
  const top = Math.max(0, y)
  const right = Math.min(w, x + width)
  const bottom = Math.min(h, y + height)
  if (right <= left || bottom <= top) return null
  if (left === 0 && top === 0 && right === w && bottom === h) return null
  const round = (n) => Math.round(n * 10) / 10
  return { x: round(left), y: round(top), width: round(right - left), height: round(bottom - top) }
}

// ── framing (the screen) ──────────────────────────────────────────────────
// A new view is glided to, not jumped to, so the table can follow where the
// GM went. It plays with reduced motion too: it says where the view went.

const FRAME_MS = 280
const framed = ref(null) // { x, y, width, height } shown now
let frameRaf = null

const wholeImage = () => ({ x: 0, y: 0, width: naturalWidth.value, height: naturalHeight.value })

watch([() => props.view, naturalWidth], ([view]) => {
  if (!naturalWidth.value) return
  const to = view || wholeImage()
  const from = framed.value
  cancelAnimationFrame(frameRaf)
  if (!from || typeof requestAnimationFrame === 'undefined') {
    framed.value = to
    return
  }
  const start = performance.now()
  const step = () => {
    const t = Math.min(1, (performance.now() - start) / FRAME_MS)
    const e = 1 - (1 - t) ** 3
    framed.value = {
      x: from.x + (to.x - from.x) * e,
      y: from.y + (to.y - from.y) * e,
      width: from.width + (to.width - from.width) * e,
      height: from.height + (to.height - from.height) * e
    }
    frameRaf = t < 1 ? requestAnimationFrame(step) : null
  }
  frameRaf = requestAnimationFrame(step)
}, { immediate: true })

const viewBox = computed(() => {
  const f = props.zoomable ? null : framed.value
  return f ? `${f.x} ${f.y} ${f.width} ${f.height}` : `0 0 ${naturalWidth.value} ${naturalHeight.value}`
})

// Sizes follow the cell, so a token keeps its look at any grid size.
const cell = computed(() => props.grid.size)
const lineWidth = computed(() => Math.max(1, cell.value * 0.025))
const ringWidth = computed(() => Math.max(2, cell.value * 0.05))
const labelSize = computed(() => Math.max(10, cell.value * 0.24))

const cellsOf = (point) => {
  const cells = toCells(props.grid, point.x, point.y)
  return { x: Math.round(cells.x * 100) / 100, y: Math.round(cells.y * 100) / 100 }
}
const cellPoint = (event) => {
  const point = pointer(event)
  return point && cellsOf(point)
}

// ── measuring: the ruler, and a token's move ──────────────────────────────
// { kind: 'ruler' | 'token', token (its id), points: [start, ...turns], current }, in pixels.

const measuring = ref(null)
const ghost = computed(() => {
  if (measuring.value?.kind !== 'token') return null
  return props.tokens.find((t) => t.id === measuring.value.token) || null
})

function reportMeasure(end = false) {
  const m = measuring.value
  if (!m) return
  emit('measure', { points: [...m.points, m.current].map(cellsOf), token: m.token || null, end })
}

function addTurn() {
  const m = measuring.value
  const last = m?.points[m.points.length - 1]
  if (!m || (last.x === m.current.x && last.y === m.current.y)) return
  m.points.push({ ...m.current })
  reportMeasure()
}

function dropTurn() {
  const m = measuring.value
  if (!m || m.points.length < 2) return
  m.points.pop()
  reportMeasure()
}

const dragging = () => tokenDrag.active() || ruling.active()

function onKey(event) {
  if (!dragging() || !measuring.value) return
  if (event.key === ' ') {
    // Not also a press of whatever button has the focus.
    event.preventDefault()
    if (event.type === 'keydown' && !event.repeat) addTurn()
  } else if (event.key === 'Backspace' && event.type === 'keydown') {
    event.preventDefault()
    dropTurn()
  }
}
window.addEventListener('keydown', onKey)
window.addEventListener('keyup', onKey)

// ── tokens ────────────────────────────────────────────────────────────────

// Once a token is let go of, it is drawn where it was put until the
// document catches up (a moment), not back where the document still has it.
const override = ref(null)
const draggingId = ref(null)
let releaseTimer = null

const placed = (token) => (override.value?.id === token.id && draggingId.value !== token.id ? { ...token, x: override.value.x, y: override.value.y } : token)
// A token that has just moved is drawn where it is on its way there.
const { centerOf, travel } = useTokenTravel({ tokens: () => props.tokens, layer: () => props.signals })
const center = (token) => {
  const travelling = centerOf(token)
  return travelling ? toPixels(props.grid, travelling.x, travelling.y) : tokenCenter(props.grid, placed(token))
}

watch(() => props.tokens, (tokens) => {
  const held = override.value
  if (!held || tokenDrag.active()) return
  const token = tokens.find((t) => t.id === held.id)
  if (!token || (token.x === held.x && token.y === held.y)) override.value = null
}, { deep: true })

// A token's ghost follows the pointer that grabbed it (the primary button,
// one pointer), along the path being measured; where it is let go is where
// the token goes. If the browser cancels the gesture nothing moves.
const tokenDrag = usePointerDrag({
  toPoint: pointer,
  thresholdPx: DRAG_THRESHOLD_PX,
  onMove(point, _event, drag) {
    const cells = toCells(props.grid, point.x - drag.grab.x, point.y - drag.grab.y)
    const position = snapPosition(props.grid, cells.x, cells.y)
    override.value = { id: drag.id, ...position }
    const token = props.tokens.find((t) => t.id === drag.id)
    measuring.value = {
      kind: 'token',
      token: drag.id,
      points: measuring.value?.points || [tokenCenter(props.grid, { ...token, ...drag.from })],
      current: tokenCenter(props.grid, { ...token, ...position })
    }
    reportMeasure()
  },
  onEnd(drag, { moved }) {
    draggingId.value = null
    if (moved) reportMeasure(true)
    const path = measuring.value ? [...measuring.value.points, measuring.value.current].map(cellsOf) : null
    measuring.value = null
    if (!moved || !override.value) {
      override.value = null
      return
    }
    const { x, y } = override.value
    // It walks there, along the path it was dragged, turns and all.
    if (path) travel(drag.id, path)
    emit('move', drag.id, { x, y })
    // Let go of the pointer's position once the document has had time to agree.
    releaseTimer = setTimeout(() => { override.value = null }, 1000)
  },
  onCancel(_drag, { moved }) {
    draggingId.value = null
    if (moved) reportMeasure(true)
    measuring.value = null
    override.value = null
  }
})

function onTokenDown(token, event) {
  // A second finger while something is being dragged: a turn in its path.
  if (dragging()) {
    addTurn()
    return
  }
  emit('select', token.id)
  if (!props.editable || props.tool !== 'select') return
  const point = pointer(event)
  if (!point) return
  const topLeft = toPixels(props.grid, token.x, token.y)
  const grab = { x: point.x - topLeft.x, y: point.y - topLeft.y }
  if (!tokenDrag.start(event, { id: token.id, grab, from: { x: token.x, y: token.y } })) return
  clearTimeout(releaseTimer)
  override.value = null
  measuring.value = null
  draggingId.value = token.id
}

// ── the ruler ─────────────────────────────────────────────────────────────

const rulerPoint = (event) => {
  const point = pointer(event)
  return point && cellCenter(props.grid, point.x, point.y)
}

const ruling = usePointerDrag({
  toPoint: rulerPoint,
  onMove(to) {
    measuring.value = { ...measuring.value, current: to }
    reportMeasure()
  },
  onEnd() {
    // It stays up here until the next one; everyone else's copy fades.
    reportMeasure(true)
  },
  onCancel() {
    reportMeasure(true)
    measuring.value = null
  }
})

// ── areas ─────────────────────────────────────────────────────────────────

const areaPreview = ref(null)
// { id, ...fields } while an area is moved or reshaped, and a moment after:
// drawn as the pointer has it until the document agrees.
const areaOverride = ref(null)

const shownAreas = computed(() => {
  const held = areaOverride.value
  const areas = props.areas.map((area) => (held?.id === area.id ? { ...area, ...held } : area))
  return areaPreview.value ? [...areas, { ...areaPreview.value, id: 'preview', preview: true }] : areas
})

watch(() => props.areas, (areas) => {
  const held = areaOverride.value
  if (!held || areaMove.active() || reaching.active()) return
  const area = areas.find((a) => a.id === held.id)
  if (!area || Object.entries(held).every(([field, value]) => area[field] === value)) areaOverride.value = null
}, { deep: true })

const areaDraw = usePointerDrag({
  toPoint: cellPoint,
  thresholdPx: DRAG_THRESHOLD_PX,
  onMove(to, _event, state) {
    areaPreview.value = areaFromDrag(props.grid, props.areaShape, state.origin, to)
  },
  onEnd() {
    if (areaPreview.value) {
      const { shape, x, y, size, angle } = areaPreview.value
      emit('add-area', { shape, x, y, size, angle })
    }
    areaPreview.value = null
  },
  onCancel() {
    areaPreview.value = null
  }
})

// An area is moved by its origin, on a cell's centre or corner when the grid snaps.
const areaMove = usePointerDrag({
  toPoint: cellPoint,
  thresholdPx: DRAG_THRESHOLD_PX,
  onMove(to, _event, state) {
    const x = to.x - state.grab.x
    const y = to.y - state.grab.y
    const snaps = props.grid.type === 'square' && props.grid.snap
    areaOverride.value = snaps
      ? { id: state.id, x: Math.round(x * 2) / 2, y: Math.round(y * 2) / 2 }
      : { id: state.id, x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 }
  },
  onEnd(state, { moved }) {
    if (!moved || !areaOverride.value) {
      areaOverride.value = null
      return
    }
    emit('move-area', state.id, { x: areaOverride.value.x, y: areaOverride.value.y })
  },
  onCancel() {
    areaOverride.value = null
  }
})

function onAreaDown(area, event) {
  if (props.tool !== 'select' || area.preview) return
  emit('select-area', area.id)
  if (!props.editable) return
  const at = cellPoint(event)
  if (at) areaMove.start(event, { id: area.id, grab: { x: at.x - area.x, y: at.y - area.y } })
}

// The selected area's reach handle: dragged, it sets how far the area
// reaches (and, for a cone or a line, which way), as drawing it would.
const reaching = usePointerDrag({
  toPoint: cellPoint,
  onMove(to, _event, state) {
    const { size, angle } = areaFromDrag(props.grid, state.area.shape, { x: state.area.x, y: state.area.y }, to)
    areaOverride.value = { id: state.area.id, size, angle }
  },
  onEnd(state, { moved }) {
    if (!moved || !areaOverride.value) {
      areaOverride.value = null
      return
    }
    const { size, angle } = areaOverride.value
    emit('reshape-area', state.area.id, { size, angle })
  },
  onCancel() {
    areaOverride.value = null
  }
})

function onReachDown(area, event) {
  if (!props.editable) return
  reaching.start(event, { area })
}

// ── the pointer ───────────────────────────────────────────────────────────

const pointing = usePointerDrag({
  toPoint: cellPoint,
  thresholdPx: DRAG_THRESHOLD_PX,
  onMove(point) {
    emit('point', point)
  },
  onEnd(state, { moved }) {
    if (moved) emit('release')
    else emit('ping', state.from)
  },
  onCancel(_state, { moved }) {
    if (moved) emit('release')
  }
})

// ── the bare map ──────────────────────────────────────────────────────────

watch(() => props.tool, () => {
  measuring.value = null
  areaPreview.value = null
})

function onBackgroundDoubleClick(event) {
  if (props.tool !== 'select') return
  const at = cellPoint(event)
  if (at) emit('ping', at)
}

function onBackgroundDown(event) {
  if (dragging()) {
    addTurn()
    return
  }
  if (props.tool === 'pointer') {
    const from = cellPoint(event)
    if (from) pointing.start(event, { from })
  } else if (props.tool === 'ruler') {
    if (event.button) return
    const from = rulerPoint(event)
    if (!from || !ruling.start(event)) return
    measuring.value = { kind: 'ruler', points: [from], current: from }
  } else if (props.tool === 'area') {
    const origin = cellPoint(event)
    if (origin && props.editable) areaDraw.start(event, { origin })
  } else {
    emit('select', null)
    emit('select-area', null)
  }
}

onBeforeUnmount(() => {
  cancelAnimationFrame(frameRaf)
  clearTimeout(releaseTimer)
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('keyup', onKey)
})
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

.canvas-svg.tool-ruler,
.canvas-svg.tool-pointer,
.canvas-svg.tool-area {
  cursor: crosshair;
}

.grid-rect {
  pointer-events: none;
}

.zoom {
  position: absolute;
  right: var(--space-3);
  bottom: var(--space-3);
  display: flex;
  gap: 2px;
  padding: 2px;
  background: var(--surface-chrome);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

/* Only the select tool picks things up; the others work on the bare map. */
/* (Each part says so: a part's own pointer-events would beat its group's.) */
.canvas-svg:not(.tool-select) .token,
.canvas-svg:not(.tool-select) .area,
.canvas-svg:not(.tool-select) .area * {
  pointer-events: none;
}

.area-fill {
  fill: var(--area);
  fill-opacity: 0.18;
  pointer-events: none;
}

.area-outline {
  fill: none;
  stroke: var(--area);
  stroke-opacity: 0.9;
  pointer-events: none;
}

/* The outline as the pointer finds it: wide, invisible. */
.area-hit {
  fill: none;
  stroke: transparent;
  pointer-events: stroke;
  cursor: move;
}

.area-handle {
  fill: var(--area);
  stroke: #fff;
  stroke-width: 2;
  cursor: move;
}

/* Selected, it is picked up by its inside too, and its reach handle shows. */
.area.selected .area-fill {
  fill-opacity: 0.28;
  pointer-events: visiblePainted;
  cursor: move;
}

.area-reach {
  fill: #fff;
  stroke: var(--area);
  stroke-width: 3;
  cursor: nwse-resize;
}

.area.preview .area-hit {
  pointer-events: none;
}

.area.selected .area-outline {
  stroke: #fff;
}

/* Only the table sees it: dashed here, absent from screens. */
.area.hidden {
  opacity: 0.6;
}

.area.hidden .area-outline,
.area.preview .area-outline {
  stroke-dasharray: 8 6;
}

.area-label {
  fill: #fff;
  font-weight: 600;
  paint-order: stroke;
  stroke: rgba(0, 0, 0, 0.85);
  stroke-width: 3px;
  stroke-linejoin: round;
  pointer-events: none;
}
</style>
