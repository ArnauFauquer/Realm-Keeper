<template>
  <div class="chart-canvas" :class="{ editable }">
    <div v-if="!chart.image_url" class="empty-map">
      <span class="mdi mdi-image-plus"></span>
      <p v-if="editable">Upload a background image to start charting.</p>
      <p v-else>This chart has no map image yet.</p>
      <label v-if="editable" class="upload-btn">
        <span class="mdi mdi-upload"></span> Upload map image
        <input type="file" accept="image/*" hidden @change="onMapImageSelected" />
      </label>
    </div>

    <div v-else class="canvas-viewport" ref="viewportRef">
      <svg
        v-if="naturalWidth"
        ref="svgRef"
        class="canvas-svg"
        :viewBox="`0 0 ${naturalWidth} ${naturalHeight}`"
        preserveAspectRatio="xMidYMid meet"
        :class="`mode-${mode}`"
        @click="onCanvasClick"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointerleave="onPointerUp"
      >
        <defs>
          <marker
            v-for="path in chart.paths"
            :key="'arrow-' + path.id"
            :id="`path-arrow-${path.id}`"
            viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" :fill="path.color || DEFAULT_PATH_COLOR" />
          </marker>
          <clipPath v-for="pin in chart.pins" :key="'clip-' + pin.id" :id="`pin-clip-${pin.id}`">
            <circle :cy="-needleLength" :r="headRadius" />
          </clipPath>
        </defs>

        <g ref="zoomGroupRef">
          <image :href="resolvedImageUrl" x="0" y="0" :width="naturalWidth" :height="naturalHeight" preserveAspectRatio="none" />

          <!-- Paths -->
          <g v-for="path in chart.paths" :key="path.id" class="chart-path-group">
            <path
              :d="pathData(path)"
              class="chart-path"
              :class="{ selected: selectedId === path.id }"
              :stroke="selectedId === path.id ? null : (path.color || DEFAULT_PATH_COLOR)"
              :stroke-width="pathStrokeWidth"
              :marker-end="path.direction === 'forward' ? `url(#path-arrow-${path.id})` : null"
              :marker-start="path.direction === 'reverse' ? `url(#path-arrow-${path.id})` : null"
            />
            <path
              v-if="editable"
              :d="pathData(path)"
              class="chart-path-hit"
              :stroke-width="pathHitWidth"
              @click.stop="selectElement('path', path.id)"
            />
            <template v-if="editable && selectedId === path.id">
              <circle
                v-for="(pt, i) in path.points"
                :key="i"
                class="path-handle"
                :cx="toPx(pt.x)" :cy="toPy(pt.y)" :r="handleRadius"
                @pointerdown.stop="startDrag('pathPoint', path.id, i)"
                @mousedown.stop.prevent
                @touchstart.stop
              />
            </template>
          </g>

          <!-- Drawing-in-progress path -->
          <polyline
            v-if="drawingPoints.length"
            class="drawing-path"
            :stroke="nextPathColor"
            :stroke-width="pathStrokeWidth"
            :points="drawingPoints.map(p => `${toPx(p.x)},${toPy(p.y)}`).join(' ')"
          />
          <circle
            v-for="(p, i) in drawingPoints"
            :key="'draft-' + i"
            class="drawing-point"
            :cx="toPx(p.x)" :cy="toPy(p.y)" :r="handleRadius"
          />

          <!-- Annotations -->
          <template v-for="note in chart.annotations" :key="note.id">
            <foreignObject
              class="annotation-box"
              :class="{ selected: selectedId === note.id }"
              :x="toPx(note.x) - annotationWidthFor(note) / 2"
              :y="toPy(note.y) - annotationHeightFor(note) / 2"
              :width="annotationWidthFor(note)"
              :height="annotationHeightFor(note)"
              @pointerdown.stop="editable && startDrag('annotation', note.id)"
              @click.stop="editable && selectElement('annotation', note.id)"
              @mousedown.stop.prevent
              @touchstart.stop
            >
              <div class="annotation-content" :style="{ fontSize: annotationFontSizeFor(note) + 'px' }">
                <textarea
                  v-if="editable && editingAnnotationId === note.id"
                  :value="note.text"
                  class="annotation-input"
                  placeholder="Write a note..."
                  @input="updateAnnotationText(note.id, $event.target.value)"
                  @pointerdown.stop
                  @click.stop
                  @blur="editingAnnotationId = null"
                ></textarea>
                <span v-else class="annotation-text" @dblclick.stop="editable && (editingAnnotationId = note.id)">
                  {{ note.text || 'Empty note' }}
                </span>
              </div>
            </foreignObject>
            <circle
              v-if="editable && selectedId === note.id"
              class="resize-handle"
              :cx="toPx(note.x) + annotationWidthFor(note) / 2"
              :cy="toPy(note.y) + annotationHeightFor(note) / 2"
              :r="handleRadius"
              @pointerdown.stop="startAnnotationResize(note, $event)"
              @mousedown.stop.prevent
              @touchstart.stop
            />
          </template>

          <!-- Pins -->
          <g
            v-for="pin in chart.pins"
            :key="pin.id"
            class="chart-pin"
            :class="{ selected: selectedId === pin.id }"
            :transform="`translate(${toPx(pin.x)}, ${toPy(pin.y)})`"
            @pointerdown.stop="editable && startDrag('pin', pin.id)"
            @click.stop="onPinClick(pin)"
            @mousedown.stop.prevent
            @touchstart.stop
            @mouseenter="hoveredPin = pin"
            @mouseleave="hoveredPin = hoveredPin === pin ? null : hoveredPin"
          >
            <circle class="pin-halo" :cy="-needleLength" :r="headRadius * 1.6" />
            <line class="pin-needle" x1="0" y1="0" x2="0" :y2="-needleLength" :stroke-width="pinStrokeWidth" />
            <circle class="pin-head" :cy="-needleLength" :r="headRadius" :fill="pin.icon_url ? '#1a1b3a' : '#a78bfa'" :stroke-width="pinStrokeWidth" />
            <image
              v-if="pin.icon_url"
              :href="resolveUrl(pin.icon_url)"
              :x="-headRadius" :y="-needleLength - headRadius"
              :width="headRadius * 2" :height="headRadius * 2"
              :clip-path="`url(#pin-clip-${pin.id})`"
              preserveAspectRatio="xMidYMid slice"
              class="pin-icon-image"
            />
            <circle v-if="pin.icon_url" class="pin-head-ring" :cy="-needleLength" :r="headRadius" :stroke-width="pinStrokeWidth * 0.6" />
          </g>
        </g>
      </svg>

      <!-- Hover tooltip -->
      <div v-if="hoveredPin" class="pin-tooltip">
        <img v-if="hoveredPin.icon_url" :src="resolveUrl(hoveredPin.icon_url)" class="pin-tooltip-icon" />
        <span class="mdi mdi-map-marker" v-else></span>
        <span>{{ hoveredPin.name || 'No note linked' }}</span>
      </div>

      <!-- Toolbar -->
      <div v-if="editable" class="chart-toolbar">
        <button class="tool-btn" :class="{ active: mode === 'select' }" title="Select / move" @click="setMode('select')">
          <span class="mdi mdi-cursor-default"></span>
        </button>
        <button class="tool-btn" :class="{ active: mode === 'pin' }" title="Place pin" @click="setMode('pin')">
          <span class="mdi mdi-map-marker-plus"></span>
        </button>
        <button class="tool-btn" :class="{ active: mode === 'path' }" title="Draw path" @click="setMode('path')">
          <span class="mdi mdi-vector-line"></span>
        </button>
        <button class="tool-btn" :class="{ active: mode === 'annotation' }" title="Add annotation" @click="setMode('annotation')">
          <span class="mdi mdi-note-plus-outline"></span>
        </button>
        <label class="tool-btn" title="Replace map image">
          <span class="mdi mdi-image-edit-outline"></span>
          <input type="file" accept="image/*" hidden @change="onMapImageSelected" />
        </label>
      </div>

      <div v-if="editable && mode === 'path' && drawingPoints.length" class="path-hint">
        Click to add points · Enter to finish · Esc to cancel
      </div>

      <!-- Selection panel -->
      <div v-if="editable && selectedPin" class="selection-panel">
        <div class="selection-panel-header">
          <span class="mdi mdi-map-marker"></span>
          <span class="selection-title">{{ selectedPin.name || 'Unlinked pin' }}</span>
          <button
            v-if="selectedPin.note_path"
            class="icon-btn"
            title="Open linked note"
            @click="emit('open-note', selectedPin.note_path)"
          >
            <span class="mdi mdi-open-in-new"></span>
          </button>
          <button class="icon-btn danger" title="Delete pin" @click="deletePin(selectedPin.id)">
            <span class="mdi mdi-trash-can-outline"></span>
          </button>
        </div>

        <div class="note-picker">
          <input
            v-model="pinNoteQuery"
            class="selection-name-input"
            :placeholder="selectedPin.note_path ? 'Link a different note...' : 'Search a note to link...'"
            @focus="pinPickerOpen = true"
            @blur="closePinPickerSoon"
          />
          <div v-if="pinPickerOpen && filteredPinNotes.length" class="note-picker-results">
            <button
              v-for="n in filteredPinNotes"
              :key="n.id"
              class="note-picker-item"
              @mousedown.prevent="linkPinToNote(selectedPin, n)"
            >
              <span class="note-picker-title">{{ n.title || n.id }}</span>
              <span class="note-picker-path">{{ n.id }}</span>
            </button>
          </div>
        </div>

        <label class="upload-btn small">
          <span class="mdi mdi-upload"></span> {{ selectedPin.icon_url ? 'Replace icon' : 'Upload icon' }}
          <input type="file" accept="image/*" hidden @change="(e) => onPinIconSelected(e, selectedPin.id)" />
        </label>
      </div>

      <div v-if="editable && selectedPath" class="selection-panel">
        <div class="selection-panel-header">
          <span class="mdi mdi-vector-line"></span>
          <span class="selection-title">Path</span>
          <button class="icon-btn danger" title="Delete path" @click="deletePath(selectedPath.id)">
            <span class="mdi mdi-trash-can-outline"></span>
          </button>
        </div>
        <div class="direction-toggle">
          <button
            v-for="dir in ['forward', 'reverse', 'none']"
            :key="dir"
            class="direction-btn"
            :class="{ active: selectedPath.direction === dir }"
            @click="setPathDirection(selectedPath.id, dir)"
          >{{ dir }}</button>
        </div>
      </div>

      <div v-if="editable && selectedAnnotation" class="selection-panel">
        <div class="selection-panel-header">
          <span class="mdi mdi-note-text-outline"></span>
          <span class="selection-title">Annotation</span>
          <button class="icon-btn danger" title="Delete annotation" @click="deleteAnnotation(selectedAnnotation.id)">
            <span class="mdi mdi-trash-can-outline"></span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import * as d3 from 'd3'
import { apiUrl } from '@/config/env'

const props = defineProps({
  chart: { type: Object, required: true },
  editable: { type: Boolean, default: false },
  notes: { type: Array, default: () => [] },
  // false on /screen: that view is a static fullscreen projection, not
  // something a viewer pans/zooms around in.
  zoomable: { type: Boolean, default: true }
})

// Cycled through in order as paths are created, so each new path reads as
// distinct from the one before it. DEFAULT_PATH_COLOR covers paths saved
// before this field existed.
const PATH_COLORS = ['#a78bfa', '#22d3ee', '#f472b6', '#34d399', '#fbbf24', '#60a5fa', '#fb7185', '#c084fc']
const DEFAULT_PATH_COLOR = PATH_COLORS[0]
const nextPathColor = computed(() => PATH_COLORS[props.chart.paths.length % PATH_COLORS.length])

const emit = defineEmits(['change', 'upload-map-image', 'upload-pin-icon', 'open-note'])

const svgRef = ref(null)
const zoomGroupRef = ref(null)
const viewportRef = ref(null)
const naturalWidth = ref(0)
const naturalHeight = ref(0)
const mode = ref('select')
const selectedId = ref(null)
const hoveredPin = ref(null)
const drawingPoints = ref([])
const editingAnnotationId = ref(null)
const pinNoteQuery = ref('')
const pinPickerOpen = ref(false)

let dragState = null
let dragMoved = false
let zoomBehavior = null

function resolveUrl(url) {
  if (!url) return url
  return url.startsWith('http') ? url : `${apiUrl}${url}`
}

const resolvedImageUrl = computed(() => resolveUrl(props.chart.image_url))

function loadImageSize(url) {
  if (!url) {
    naturalWidth.value = 0
    naturalHeight.value = 0
    return
  }
  const img = new Image()
  img.onload = () => {
    naturalWidth.value = img.naturalWidth
    naturalHeight.value = img.naturalHeight
  }
  img.src = resolveUrl(url)
}

watch(() => props.chart.image_url, loadImageSize, { immediate: true })

watch(editingAnnotationId, (id) => {
  if (!id) return
  nextTick(() => {
    viewportRef.value?.querySelector('.annotation-input')?.focus()
  })
})

// Sized relative to the image's shorter side so proportions stay sane
// regardless of the map's resolution. Pins/annotations are small by
// default and, since they live inside the zoomed <g>, scale up naturally
// as the user zooms in — same as the map itself.
const shortSide = computed(() => Math.min(naturalWidth.value, naturalHeight.value) || 800)
const markerSize = computed(() => shortSide.value * 0.025)
const headRadius = computed(() => markerSize.value / 2)
const needleLength = computed(() => markerSize.value * 1.3)
const pinStrokeWidth = computed(() => markerSize.value * 0.12)
const handleRadius = computed(() => shortSide.value * 0.008)
const pathStrokeWidth = computed(() => shortSide.value * 0.006)
const pathHitWidth = computed(() => shortSide.value * 0.02)
const baseAnnotationWidth = computed(() => shortSide.value * 0.09)
const ANNOTATION_SCALE_MIN = 0.4
const ANNOTATION_SCALE_MAX = 4
function annotationWidthFor(note) { return baseAnnotationWidth.value * (note.scale || 1) }
function annotationHeightFor(note) { return annotationWidthFor(note) * 0.55 }
function annotationFontSizeFor(note) { return annotationWidthFor(note) * 0.11 }

function toPx(xPercent) { return (xPercent / 100) * naturalWidth.value }
function toPy(yPercent) { return (yPercent / 100) * naturalHeight.value }

function pathData(path) {
  const pts = path.points.map(p => [toPx(p.x), toPy(p.y)])
  const gen = d3.line().curve(d3.curveCatmullRom.alpha(0.5))
  return gen(pts)
}

function setupZoom() {
  if (!props.zoomable || !svgRef.value || !zoomGroupRef.value) return
  const svgSel = d3.select(svgRef.value)
  const g = d3.select(zoomGroupRef.value)
  zoomBehavior = d3.zoom()
    .scaleExtent([0.5, 12])
    .filter((event) => event.type === 'wheel' || (mode.value === 'select' && !event.button))
    .on('zoom', (event) => { g.attr('transform', event.transform) })
  svgSel.call(zoomBehavior).on('dblclick.zoom', null)
}

watch(naturalWidth, async (w) => {
  if (w > 0) {
    await nextTick()
    setupZoom()
  }
})

watch(() => props.chart.id, () => {
  if (zoomBehavior && svgRef.value) {
    d3.select(svgRef.value).call(zoomBehavior.transform, d3.zoomIdentity)
  }
})

function clientToPercent(evt) {
  if (!zoomGroupRef.value || !naturalWidth.value) return null
  const [x, y] = d3.pointer(evt, zoomGroupRef.value)
  return {
    x: Math.min(100, Math.max(0, (x / naturalWidth.value) * 100)),
    y: Math.min(100, Math.max(0, (y / naturalHeight.value) * 100))
  }
}

function clientToViewBoxPoint(evt) {
  if (!zoomGroupRef.value) return null
  const [x, y] = d3.pointer(evt, zoomGroupRef.value)
  return { x, y }
}

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function emitChange() {
  emit('change', {
    pins: props.chart.pins,
    paths: props.chart.paths,
    annotations: props.chart.annotations
  })
}

function setMode(m) {
  if (mode.value === 'path' && drawingPoints.value.length) {
    drawingPoints.value = []
  }
  mode.value = m
  selectedId.value = null
}

function selectElement(kind, id) {
  if (mode.value !== 'select') return
  selectedId.value = id
}

function onPinClick(pin) {
  if (dragMoved) return
  if (props.editable) {
    selectElement('pin', pin.id)
  } else if (pin.note_path) {
    emit('open-note', pin.note_path)
  }
}

const filteredPinNotes = computed(() => {
  const q = pinNoteQuery.value.trim().toLowerCase()
  const list = props.notes || []
  if (!q) return list.slice(0, 8)
  return list.filter(n =>
    (n.title || '').toLowerCase().includes(q) || n.id.toLowerCase().includes(q)
  ).slice(0, 8)
})

function linkPinToNote(pin, note) {
  pin.note_path = note.id
  pin.name = note.title || note.id
  pinNoteQuery.value = ''
  pinPickerOpen.value = false
  emitChange()
}

function closePinPickerSoon() {
  setTimeout(() => { pinPickerOpen.value = false }, 150)
}

watch(selectedId, () => {
  pinNoteQuery.value = ''
  pinPickerOpen.value = false
})

function onCanvasClick(evt) {
  if (!props.editable) return
  const pos = clientToPercent(evt)
  if (!pos) return

  if (mode.value === 'pin') {
    props.chart.pins.push({ id: uuid(), x: pos.x, y: pos.y, name: '', icon_url: null, note_path: null })
    emitChange()
    mode.value = 'select'
    selectedId.value = props.chart.pins[props.chart.pins.length - 1].id
  } else if (mode.value === 'annotation') {
    const note = { id: uuid(), x: pos.x, y: pos.y, text: '', scale: 1 }
    props.chart.annotations.push(note)
    emitChange()
    mode.value = 'select'
    editingAnnotationId.value = note.id
  } else if (mode.value === 'path') {
    drawingPoints.value.push(pos)
  } else {
    selectedId.value = null
  }
}

function onKeydown(evt) {
  if (mode.value !== 'path') return
  if (evt.key === 'Enter' && drawingPoints.value.length >= 2) {
    props.chart.paths.push({ id: uuid(), points: [...drawingPoints.value], direction: 'forward', color: nextPathColor.value })
    emitChange()
    drawingPoints.value = []
    mode.value = 'select'
  } else if (evt.key === 'Escape') {
    drawingPoints.value = []
    mode.value = 'select'
  }
}
window.addEventListener('keydown', onKeydown)
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

function startDrag(kind, id, pointIndex = null) {
  dragState = { kind, id, pointIndex }
  dragMoved = false
  selectedId.value = id
}

function startAnnotationResize(note, evt) {
  const center = { x: toPx(note.x), y: toPy(note.y) }
  const p = clientToViewBoxPoint(evt)
  if (!p) return
  dragState = {
    kind: 'annotationResize',
    id: note.id,
    centerX: center.x,
    centerY: center.y,
    startDist: Math.hypot(p.x - center.x, p.y - center.y) || 1,
    startScale: note.scale || 1
  }
  dragMoved = false
  selectedId.value = note.id
}

function onPointerMove(evt) {
  if (!dragState) return

  if (dragState.kind === 'annotationResize') {
    const p = clientToViewBoxPoint(evt)
    if (!p) return
    dragMoved = true
    const note = props.chart.annotations.find(a => a.id === dragState.id)
    if (note) {
      const dist = Math.hypot(p.x - dragState.centerX, p.y - dragState.centerY) || 1
      const scale = dragState.startScale * (dist / dragState.startDist)
      note.scale = Math.min(ANNOTATION_SCALE_MAX, Math.max(ANNOTATION_SCALE_MIN, scale))
    }
    return
  }

  const pos = clientToPercent(evt)
  if (!pos) return
  dragMoved = true

  if (dragState.kind === 'pin') {
    const pin = props.chart.pins.find(p => p.id === dragState.id)
    if (pin) { pin.x = pos.x; pin.y = pos.y }
  } else if (dragState.kind === 'annotation') {
    const note = props.chart.annotations.find(a => a.id === dragState.id)
    if (note) { note.x = pos.x; note.y = pos.y }
  } else if (dragState.kind === 'pathPoint') {
    const path = props.chart.paths.find(p => p.id === dragState.id)
    if (path) { path.points[dragState.pointIndex] = pos }
  }
}

function onPointerUp() {
  if (dragState) {
    dragState = null
    if (dragMoved) emitChange()
  }
}

const selectedPin = computed(() => props.chart.pins.find(p => p.id === selectedId.value) || null)
const selectedPath = computed(() => props.chart.paths.find(p => p.id === selectedId.value) || null)
const selectedAnnotation = computed(() => props.chart.annotations.find(a => a.id === selectedId.value) || null)

function updateAnnotationText(id, text) {
  const note = props.chart.annotations.find(a => a.id === id)
  if (note) { note.text = text; emitChange() }
}

function deletePin(id) {
  props.chart.pins = props.chart.pins.filter(p => p.id !== id)
  selectedId.value = null
  emitChange()
}

function deletePath(id) {
  props.chart.paths = props.chart.paths.filter(p => p.id !== id)
  selectedId.value = null
  emitChange()
}

function deleteAnnotation(id) {
  props.chart.annotations = props.chart.annotations.filter(a => a.id !== id)
  selectedId.value = null
  emitChange()
}

function setPathDirection(id, direction) {
  const path = props.chart.paths.find(p => p.id === id)
  if (path) { path.direction = direction; emitChange() }
}

function onMapImageSelected(evt) {
  const file = evt.target.files[0]
  if (file) emit('upload-map-image', file)
  evt.target.value = ''
}

function onPinIconSelected(evt, pinId) {
  const file = evt.target.files[0]
  if (file) emit('upload-pin-icon', { pinId, file })
  evt.target.value = ''
}

</script>

<style scoped>
.chart-canvas {
  width: 100%;
  height: 100%;
  position: relative;
  background: radial-gradient(ellipse at 30% 40%, rgba(20, 15, 60, 0.9) 0%, rgba(5, 6, 20, 1) 60%, rgba(2, 3, 12, 1) 100%);
}

.empty-map {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  color: var(--text-secondary);
  text-align: center;
  padding: 2rem;
}

.empty-map .mdi {
  font-size: 3rem;
  opacity: 0.5;
}

.canvas-viewport {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  /* Dragging a pin/path/annotation shouldn't also drag-select the
     surrounding labels (toolbar, tooltip, selection panel). Inputs and
     textareas inside keep their own text selection regardless. */
  user-select: none;
  -webkit-user-select: none;
}

.canvas-svg {
  width: 100%;
  height: 100%;
  display: block;
}

.canvas-svg.mode-select {
  cursor: grab;
}

.canvas-svg.mode-select:active {
  cursor: grabbing;
}

.canvas-svg.mode-pin, .canvas-svg.mode-annotation, .canvas-svg.mode-path {
  cursor: crosshair;
}

.chart-pin {
  cursor: pointer;
}

.pin-halo {
  fill: rgba(138, 92, 245, 0.25);
  opacity: 0;
  transition: opacity 0.15s ease;
}

.chart-pin:hover .pin-halo,
.chart-pin.selected .pin-halo {
  opacity: 1;
}

.pin-needle {
  stroke: rgba(226, 224, 235, 0.85);
  stroke-linecap: round;
}

.pin-head {
  stroke: rgba(12, 13, 29, 0.9);
  filter: drop-shadow(0 2px 3px rgba(0, 0, 0, 0.5));
}

.pin-icon-image {
  filter: drop-shadow(0 2px 3px rgba(0, 0, 0, 0.5));
}

.pin-head-ring {
  fill: none;
  stroke: rgba(255, 255, 255, 0.4);
}

.chart-path {
  fill: none;
  stroke-dasharray: 2 6;
  stroke-linecap: round;
  pointer-events: none;
}

.chart-path.selected {
  stroke: #22d3ee;
}

.chart-path-hit {
  fill: none;
  stroke: rgba(0, 0, 0, 0.01);
  cursor: pointer;
}

.path-handle {
  fill: #22d3ee;
  stroke: rgba(12, 13, 29, 0.9);
  stroke-width: 1;
  cursor: grab;
}

.resize-handle {
  fill: #22d3ee;
  stroke: rgba(12, 13, 29, 0.9);
  stroke-width: 1;
  cursor: nwse-resize;
}

.drawing-path {
  fill: none;
  stroke-dasharray: 4 4;
}

.drawing-point {
  fill: #22d3ee;
}

.annotation-box {
  overflow: visible;
}

.annotation-content {
  width: 100%;
  height: 100%;
  background: rgba(12, 13, 29, 0.88);
  border: 1px solid var(--border-medium);
  border-radius: 6px;
  padding: 6% 8%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-primary);
  box-sizing: border-box;
  cursor: pointer;
}

.annotation-box.selected .annotation-content {
  border-color: var(--interactive-primary);
}

.annotation-text {
  text-align: center;
  overflow-wrap: break-word;
}

.annotation-input {
  width: 100%;
  height: 100%;
  background: transparent;
  border: none;
  color: var(--text-primary);
  resize: none;
  font-family: inherit;
  font-size: inherit;
  user-select: text;
  -webkit-user-select: text;
}

.annotation-input:focus {
  outline: none;
}

.pin-tooltip {
  position: absolute;
  top: 1rem;
  left: 1rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  background: rgba(12, 13, 29, 0.92);
  border: 1px solid var(--border-medium);
  border-radius: 8px;
  color: var(--text-primary);
  font-size: 0.875rem;
  pointer-events: none;
  z-index: 5;
}

.pin-tooltip-icon {
  width: 20px;
  height: 20px;
  object-fit: contain;
  border-radius: 3px;
}

.chart-toolbar {
  position: absolute;
  top: 1rem;
  right: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  background: rgba(12, 13, 29, 0.9);
  backdrop-filter: blur(12px);
  border: 1px solid var(--border-light);
  border-radius: 12px;
  padding: 0.4rem;
}

.tool-btn {
  width: 40px;
  height: 40px;
  border-radius: 8px;
  background: transparent;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}

.tool-btn .mdi {
  font-size: 1.3rem;
}

.tool-btn:hover {
  background: var(--interactive-secondary);
  color: var(--text-primary);
}

.tool-btn.active {
  background: var(--interactive-primary);
  color: white;
}

.path-hint {
  position: absolute;
  bottom: 1rem;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(12, 13, 29, 0.9);
  border: 1px solid var(--border-medium);
  border-radius: 8px;
  padding: 0.5rem 1rem;
  color: var(--text-secondary);
  font-size: 0.8rem;
}

.selection-panel {
  position: absolute;
  bottom: 1rem;
  left: 1rem;
  background: rgba(12, 13, 29, 0.92);
  backdrop-filter: blur(12px);
  border: 1px solid var(--border-light);
  border-radius: 12px;
  padding: 0.75rem;
  min-width: 220px;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.selection-panel-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--text-secondary);
}

.selection-title {
  flex: 1;
  color: var(--text-primary);
}

.selection-name-input {
  flex: 1;
  width: 100%;
  box-sizing: border-box;
  background: rgba(26, 27, 58, 0.6);
  border: 1px solid var(--border-light);
  border-radius: 6px;
  padding: 0.35rem 0.5rem;
  color: var(--text-primary);
  font-size: 0.875rem;
  user-select: text;
  -webkit-user-select: text;
}

.selection-name-input:focus {
  outline: none;
  border-color: var(--interactive-primary);
}

.note-picker {
  position: relative;
}

.note-picker-results {
  position: absolute;
  top: calc(100% + 0.25rem);
  left: 0;
  right: 0;
  z-index: 10;
  max-height: 180px;
  overflow-y: auto;
  background: rgba(12, 13, 29, 0.98);
  border: 1px solid var(--border-medium);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  display: flex;
  flex-direction: column;
}

.note-picker-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.1rem;
  padding: 0.45rem 0.6rem;
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--border-light);
  cursor: pointer;
  text-align: left;
}

.note-picker-item:last-child {
  border-bottom: none;
}

.note-picker-item:hover {
  background: var(--interactive-secondary);
}

.note-picker-title {
  color: var(--text-primary);
  font-size: 0.8rem;
}

.note-picker-path {
  color: var(--text-tertiary, var(--text-secondary));
  font-size: 0.7rem;
}

.icon-btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  background: transparent;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  flex-shrink: 0;
}

.icon-btn.danger:hover {
  background: rgba(248, 113, 113, 0.15);
  color: var(--status-error, #f87171);
}

.upload-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  padding: 0.5rem 0.9rem;
  border: 1px solid var(--border-medium);
  border-radius: 8px;
  background: var(--interactive-secondary);
  color: var(--text-primary);
  font-size: 0.85rem;
  cursor: pointer;
  transition: all 0.15s ease;
}

.upload-btn:hover {
  border-color: var(--interactive-primary);
}

.upload-btn.small {
  padding: 0.35rem 0.7rem;
  font-size: 0.8rem;
  align-self: flex-start;
}

.direction-toggle {
  display: flex;
  gap: 0.35rem;
}

.direction-btn {
  flex: 1;
  padding: 0.3rem 0.5rem;
  border-radius: 6px;
  border: 1px solid var(--border-light);
  background: transparent;
  color: var(--text-secondary);
  font-size: 0.75rem;
  text-transform: capitalize;
  cursor: pointer;
}

.direction-btn.active {
  background: var(--interactive-primary);
  border-color: var(--interactive-primary);
  color: white;
}
</style>
