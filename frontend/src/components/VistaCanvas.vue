<template>
  <div class="vista-canvas" :class="{ editable }">
    <div v-if="!vista.background_url" class="empty-stage">
      <span class="mdi mdi-image-plus"></span>
      <p>This vista has no background yet.</p>
      <button v-if="editable" class="upload-btn" @click="openLibraryForBackground">
        <span class="mdi mdi-folder-multiple-image"></span> Choose background
      </button>
    </div>

    <div
      v-else
      class="stage-viewport"
      ref="viewportRef"
      :class="{ 'mode-asset': editable && mode === 'asset' }"
      @click="onStageClick"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointerleave="onPointerUp"
    >
      <!-- Fixed-aspect stage, letterboxed within the viewport so a scene lines
           up identically wherever it's shown (the editor modal is rarely the
           same shape as a fullscreen /screen display, and cover-sizing a
           background directly onto the viewport would crop it differently
           in each place, throwing off every x/y percent coordinate). -->
      <div class="stage-frame" :style="frameStyle">
        <div
          class="stage-background"
          :class="{ ambient: !editable, panning: editable && mode === 'select' }"
          :style="backgroundStyle"
          @pointerdown="startBackgroundPan"
        ></div>

        <!-- Assets, painter's-algorithm ordered by depth (y + any forced depth_offset): farther behind, nearer in front -->
        <div
          v-for="asset in orderedAssets"
          :key="asset.id"
          class="vista-asset"
          :class="{ selected: selectedId === asset.id, 'no-image': !asset.image_url }"
          :data-asset-id="asset.id"
          :style="assetStyle(asset)"
          @pointerdown.stop="editable && onAssetPointerDown($event, asset)"
          @click.stop="onAssetClick($event, asset)"
          @mousedown.stop.prevent
          @touchstart.stop
        >
          <!-- Rotates as one unit with the artwork, so the handles stay glued
               to its corners instead of staying behind at the unrotated
               position while only the image spins. -->
          <div class="vista-asset-spin" :style="spinStyle(asset)">
            <img
              v-if="asset.image_url"
              :src="resolveUrl(asset.image_url)"
              :alt="asset.name"
              class="vista-asset-image"
              :style="imageStyle(asset)"
              draggable="false"
            />
            <span v-else class="mdi mdi-account-outline placeholder-icon" :style="imageStyle(asset)"></span>

            <template v-if="editable && selectedId === asset.id">
              <div
                class="rotate-handle"
                title="Drag to rotate"
                @pointerdown.stop="startRotate($event, asset)"
                @click.stop="justDragged = false"
                @mousedown.stop.prevent
                @touchstart.stop
              >
                <span class="mdi mdi-rotate-right"></span>
              </div>
              <div
                class="scale-handle"
                title="Drag or scroll to resize"
                @pointerdown.stop="startScale($event, asset)"
                @wheel.stop.prevent="onScaleWheel($event, asset)"
                @click.stop="justDragged = false"
                @mousedown.stop.prevent
                @touchstart.stop
              ></div>
            </template>
          </div>
        </div>

        <!-- Perspective handle: sits beside the selected asset at the depth
             its draw order is derived from. Dragging it vertically forces that
             depth (in front of / behind other assets) without moving or
             resizing the asset itself. -->
        <template v-if="editable && selectedAsset">
          <div class="perspective-guide" :style="perspectiveGuideStyle"></div>
          <div
            class="perspective-handle"
            :class="{ forced: selectedAsset.depth_offset }"
            :style="perspectiveHandleStyle"
            title="Drag vertically to force depth order (double-click to reset)"
            @pointerdown.stop="startDrag('perspective', selectedAsset.id)"
            @click.stop="justDragged = false"
            @dblclick.stop="resetPerspective(selectedAsset)"
            @mousedown.stop.prevent
            @touchstart.stop
          ></div>
        </template>

        <!-- Vanishing point marker -->
        <div
          v-if="editable"
          class="vanishing-point"
          :style="vanishingPointStyle"
          title="Vanishing point — drag to calibrate perspective for this background"
          @pointerdown.stop="startDrag('vanishingPoint', null)"
          @click.stop="justDragged = false"
          @mousedown.stop.prevent
          @touchstart.stop
        >
          <span class="mdi mdi-crosshairs"></span>
        </div>
      </div>

      <!-- Toolbar -->
      <div v-if="editable" class="vista-toolbar" @click.stop>
        <button class="tool-btn" :class="{ active: mode === 'select' }" title="Select / move" @click="setMode('select')">
          <span class="mdi mdi-cursor-default"></span>
        </button>
        <button class="tool-btn" :class="{ active: mode === 'asset' }" title="Place asset" @click="openLibraryForNewAsset">
          <span class="mdi mdi-account-plus-outline"></span>
        </button>
        <button class="tool-btn" title="Replace background" @click="openLibraryForBackground">
          <span class="mdi mdi-image-edit-outline"></span>
        </button>
      </div>

      <div v-if="editable && mode === 'asset' && pendingLibraryItem" class="asset-hint">
        Click anywhere on the scene to place "{{ pendingLibraryItem.name }}"
      </div>

      <!-- Selection panel -->
      <div v-if="editable && selectedAsset" class="selection-panel" @click.stop>
        <div class="selection-panel-header">
          <span class="mdi mdi-account-outline"></span>
          <input
            v-model="selectedAsset.name"
            class="selection-name-input"
            placeholder="Asset name"
            @input="emitChange"
          />
          <button class="icon-btn danger" title="Delete asset" @click="deleteAsset(selectedAsset.id)">
            <span class="mdi mdi-trash-can-outline"></span>
          </button>
        </div>

        <div class="panel-row">
          <button class="upload-btn small" @click="openLibraryForAsset(selectedAsset)">
            <span class="mdi mdi-folder-multiple-image"></span> {{ selectedAsset.image_url ? 'Change image' : 'Choose image' }}
          </button>
          <button class="upload-btn small" title="Reset scale, rotation, flip and color adjustments" @click="resetAsset(selectedAsset)">
            <span class="mdi mdi-restore"></span> Reset to default
          </button>
        </div>

        <button class="flip-btn" :class="{ active: selectedAsset.flip_h }" @click="toggleFlip(selectedAsset)">
          <span class="mdi mdi-flip-horizontal"></span> Flip
        </button>

        <div class="slider-row">
          <span class="mdi mdi-opacity"></span>
          <input type="range" min="0" max="100" step="1" v-model.number="opacityPct" @input="emitChange" />
          <span class="slider-value">{{ Math.round(opacityPct) }}%</span>
        </div>

        <div class="slider-row">
          <span class="mdi mdi-brightness-6"></span>
          <input type="range" min="0" max="200" step="1" v-model.number="brightnessPct" @input="emitChange" />
          <span class="slider-value">{{ Math.round(brightnessPct) }}%</span>
        </div>

        <div class="slider-row">
          <span class="mdi mdi-contrast-circle"></span>
          <input type="range" min="0" max="200" step="1" v-model.number="saturationPct" @input="emitChange" />
          <span class="slider-value">{{ Math.round(saturationPct) }}%</span>
        </div>

        <div class="slider-row">
          <span class="mdi mdi-palette"></span>
          <input type="range" min="0" max="360" step="1" v-model.number="selectedAsset.hue_rotate" @input="emitChange" />
          <span class="slider-value">{{ Math.round(selectedAsset.hue_rotate) }}°</span>
        </div>
      </div>
    </div>

    <AssetLibraryModal
      :is-open="libraryModalOpen"
      picker-mode
      @close="libraryModalOpen = false"
      @select="onLibrarySelect"
    />
  </div>
</template>

<script setup>
import { ref, computed, watch, onBeforeUnmount, nextTick } from 'vue'
import { resolveUrl } from '@/utils/resolveUrl'
import AssetLibraryModal from './AssetLibraryModal.vue'

const props = defineProps({
  vista: { type: Object, required: true },
  editable: { type: Boolean, default: false }
})

const emit = defineEmits(['change', 'set-background'])

const libraryModalOpen = ref(false)
const pendingLibraryItem = ref(null)
let libraryTargetAsset = null
let libraryForBackground = false

// A distant asset never shrinks below this fraction of its base size — keeps
// far-away characters visible instead of vanishing to a single pixel.
const MIN_SCALE = 0.06
const GROUND_Y = 100

// Bounds for an asset's own base width_pct (before the distance scale above
// is applied), and how much one wheel notch (~100 deltaY) nudges it.
const ASSET_SCALE_MIN = 2
const ASSET_SCALE_MAX = 150
const SCALE_WHEEL_SENSITIVITY = 0.05

// Every x/y on a vista is a percentage of this fixed-ratio "stage", not of
// whatever container happens to be showing it. The editor modal and a
// fullscreen /screen display are almost never the same shape — without a
// shared frame, cover-sizing the background directly onto each container
// would crop it differently, and the same percent would land on a
// different point of the art in each place. Letterboxing to one ratio
// (matching typical TV/monitor/projector output) keeps them in sync.
const STAGE_ASPECT = 16 / 9

const viewportRef = ref(null)
const mode = ref('select')
const selectedId = ref(null)
const frameRect = ref({ left: 0, top: 0, width: 0, height: 0 })

let dragState = null
let dragMoved = false
// True for the one click event that immediately follows a real drag (asset
// move, rotate, scale, or vanishing point). That click's target often lands
// just outside the dragged element — e.g. an asset is anchored at its foot
// point, so dropping it right on that point can hit the background by a
// pixel — which would otherwise bubble to onStageClick and deselect
// whatever was just placed. Consumed (and reset) by whichever click handler
// runs next, so it never leaks into an unrelated later click.
let justDragged = false
let resizeObserver = null

function updateFrameRect() {
  if (!viewportRef.value) return
  const { width: vw, height: vh } = viewportRef.value.getBoundingClientRect()
  if (!vw || !vh) return
  let width = vw
  let height = vw / STAGE_ASPECT
  if (height > vh) {
    height = vh
    width = vh * STAGE_ASPECT
  }
  frameRect.value = { left: (vw - width) / 2, top: (vh - height) / 2, width, height }
}

function teardownFrameObserver() {
  resizeObserver?.disconnect()
  resizeObserver = null
}

async function setupFrameObserver() {
  teardownFrameObserver()
  await nextTick()
  if (!viewportRef.value) return
  updateFrameRect()
  resizeObserver = new ResizeObserver(updateFrameRect)
  resizeObserver.observe(viewportRef.value)
}

watch(() => props.vista.background_url, (url) => {
  if (url) setupFrameObserver()
  else teardownFrameObserver()
}, { immediate: true })

onBeforeUnmount(teardownFrameObserver)

const frameStyle = computed(() => ({
  left: `${frameRect.value.left}px`,
  top: `${frameRect.value.top}px`,
  width: `${frameRect.value.width}px`,
  height: `${frameRect.value.height}px`
}))

// Natural size of the background image, needed to work out how far it can
// be panned vertically once it's cover-fit into the stage frame (see
// verticalPanRangePx below) — a plain img/href sizing trick like the chart
// canvas uses won't do here since this background is a CSS background-image,
// not an <img>, so nothing else already knows its intrinsic dimensions.
const bgNaturalWidth = ref(0)
const bgNaturalHeight = ref(0)

function loadBackgroundNaturalSize(url) {
  if (!url) {
    bgNaturalWidth.value = 0
    bgNaturalHeight.value = 0
    return
  }
  const img = new Image()
  img.onload = () => {
    bgNaturalWidth.value = img.naturalWidth
    bgNaturalHeight.value = img.naturalHeight
  }
  img.src = resolveUrl(url)
}
watch(() => props.vista.background_url, loadBackgroundNaturalSize, { immediate: true })

const backgroundStyle = computed(() => ({
  backgroundImage: props.vista.background_url ? `url(${resolveUrl(props.vista.background_url)})` : 'none',
  backgroundPositionY: `${props.vista.background_offset_y ?? 50}%`
}))

// How many pixels of the cover-fit background are hidden above/below the
// frame — 0 once the image is proportionally wider than the frame, since
// "cover" then crops horizontally instead and there's nothing to pan.
function verticalPanRangePx() {
  const frame = frameRect.value
  if (!bgNaturalWidth.value || !bgNaturalHeight.value || !frame.width || !frame.height) return 0
  const coverScale = Math.max(frame.width / bgNaturalWidth.value, frame.height / bgNaturalHeight.value)
  const renderedHeight = bgNaturalHeight.value * coverScale
  return Math.max(0, renderedHeight - frame.height)
}

// Distance-based scale: an asset's apparent size is derived from how close
// its y position is to the vanishing point's y (the horizon for this
// background) versus the bottom of the stage — moving it up shrinks it.
function scaleForY(y) {
  const vpY = props.vista.vanishing_point?.y ?? 0
  const horizon = Math.min(vpY, GROUND_Y - 1)
  const clampedY = Math.min(GROUND_Y, Math.max(horizon, y))
  const ratio = (clampedY - horizon) / (GROUND_Y - horizon)
  return MIN_SCALE + (1 - MIN_SCALE) * ratio
}

// The depth an asset is layered at: its foot y, shifted by any forced
// depth_offset (see the perspective handle). Only affects draw order — size
// always follows the foot y, so forcing depth never resizes anything.
function depthY(asset) {
  return clamp(asset.y + (asset.depth_offset ?? 0), 0, GROUND_Y)
}

function assetStyle(asset) {
  const widthPct = asset.width_pct * scaleForY(asset.y)
  return {
    left: `${asset.x}%`,
    top: `${asset.y}%`,
    width: `${widthPct}%`,
    zIndex: 100 + Math.round(depthY(asset) * 10)
  }
}

// Gap, in px, between the asset's left edge and the perspective handle —
// the left side, since the scale handle already sits on the bottom-right.
const PERSPECTIVE_HANDLE_GAP = 14

function perspectiveHandleX(asset) {
  const halfWidthPct = (asset.width_pct * scaleForY(asset.y)) / 2
  return `calc(${asset.x - halfWidthPct}% - ${PERSPECTIVE_HANDLE_GAP}px)`
}

const perspectiveHandleStyle = computed(() => {
  const asset = selectedAsset.value
  if (!asset) return {}
  return { left: perspectiveHandleX(asset), top: `${depthY(asset)}%` }
})

// Dashed line from the asset's foot to the handle, so a forced depth is
// visible at a glance (zero height when there's no override).
const perspectiveGuideStyle = computed(() => {
  const asset = selectedAsset.value
  if (!asset) return {}
  const a = asset.y
  const b = depthY(asset)
  return {
    left: perspectiveHandleX(asset),
    top: `${Math.min(a, b)}%`,
    height: `${Math.abs(b - a)}%`
  }
})

function imageStyle(asset) {
  const flip = asset.flip_h ? -1 : 1
  return {
    opacity: asset.opacity ?? 1,
    filter: `drop-shadow(0 6px 10px rgba(0, 0, 0, 0.45)) brightness(${asset.brightness ?? 1}) saturate(${asset.saturation ?? 1}) hue-rotate(${asset.hue_rotate ?? 0}deg)`,
    transform: `scaleX(${flip})`
  }
}

function spinStyle(asset) {
  return { transform: `rotate(${asset.rotation ?? 0}deg)` }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

const orderedAssets = computed(() => [...props.vista.assets].sort((a, b) => depthY(a) - depthY(b)))

const vanishingPointStyle = computed(() => ({
  left: `${props.vista.vanishing_point?.x ?? 50}%`,
  top: `${props.vista.vanishing_point?.y ?? 40}%`
}))

const selectedAsset = computed(() => props.vista.assets.find(a => a.id === selectedId.value) || null)

const opacityPct = computed({
  get: () => (selectedAsset.value?.opacity ?? 1) * 100,
  set: (v) => { if (selectedAsset.value) selectedAsset.value.opacity = v / 100 }
})
const brightnessPct = computed({
  get: () => (selectedAsset.value?.brightness ?? 1) * 100,
  set: (v) => { if (selectedAsset.value) selectedAsset.value.brightness = v / 100 }
})
const saturationPct = computed({
  get: () => (selectedAsset.value?.saturation ?? 1) * 100,
  set: (v) => { if (selectedAsset.value) selectedAsset.value.saturation = v / 100 }
})

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function emitChange() {
  emit('change', {
    vanishing_point: props.vista.vanishing_point,
    background_offset_y: props.vista.background_offset_y,
    assets: props.vista.assets
  })
}

function setMode(m) {
  mode.value = m
  selectedId.value = null
  if (m !== 'asset') pendingLibraryItem.value = null
}

function openLibraryForNewAsset() {
  libraryTargetAsset = null
  libraryForBackground = false
  libraryModalOpen.value = true
}

function openLibraryForAsset(asset) {
  libraryTargetAsset = asset
  libraryForBackground = false
  libraryModalOpen.value = true
}

function openLibraryForBackground() {
  libraryTargetAsset = null
  libraryForBackground = true
  libraryModalOpen.value = true
}

function onLibrarySelect(item) {
  libraryModalOpen.value = false
  if (libraryForBackground) {
    libraryForBackground = false
    emit('set-background', item.image_url)
  } else if (libraryTargetAsset) {
    libraryTargetAsset.image_url = item.image_url
    if (!libraryTargetAsset.name) libraryTargetAsset.name = item.name
    libraryTargetAsset = null
    emitChange()
  } else {
    pendingLibraryItem.value = item
    mode.value = 'asset'
    selectedId.value = null
  }
}

function clientToPercent(evt) {
  if (!viewportRef.value) return null
  const rect = viewportRef.value.getBoundingClientRect()
  const frame = frameRect.value
  if (!frame.width || !frame.height) return null
  const x = evt.clientX - rect.left - frame.left
  const y = evt.clientY - rect.top - frame.top
  return {
    x: Math.min(100, Math.max(0, (x / frame.width) * 100)),
    y: Math.min(100, Math.max(0, (y / frame.height) * 100))
  }
}

function onStageClick(evt) {
  if (!props.editable) return
  if (justDragged) { justDragged = false; return }
  if (mode.value !== 'asset') {
    selectedId.value = null
    return
  }
  if (!pendingLibraryItem.value) return
  const pos = clientToPercent(evt)
  if (!pos) return
  const item = pendingLibraryItem.value
  const asset = {
    id: uuid(), name: item.name, image_url: item.image_url, x: pos.x, y: pos.y,
    width_pct: 20, depth_offset: 0, flip_h: false, rotation: 0, opacity: 1, brightness: 1, saturation: 1, hue_rotate: 0
  }
  props.vista.assets.push(asset)
  pendingLibraryItem.value = null
  emitChange()
  mode.value = 'select'
  selectedId.value = asset.id
}

// Ids of every asset whose box covers a screen point, topmost first — the
// same stacking the browser uses to decide which one a click lands on.
function assetIdsAt(clientX, clientY) {
  const ids = []
  for (const el of document.elementsFromPoint(clientX, clientY)) {
    const id = el.closest('.vista-asset')?.dataset.assetId
    if (id && !ids.includes(id)) ids.push(id)
  }
  return ids
}

// Set on pointerdown when the press lands on the already-selected asset, so
// the click that follows (if it wasn't a drag) cycles to the next asset
// behind it instead of reselecting the same one.
let pressedOnSelected = false

function onAssetPointerDown(evt, asset) {
  // With a background asset selected, a press where a foreground asset
  // overlaps it should still grab the selected one, otherwise it could be
  // selected by cycling but never dragged.
  const ids = assetIdsAt(evt.clientX, evt.clientY)
  pressedOnSelected = !!selectedId.value && ids.includes(selectedId.value)
  startDrag('asset', pressedOnSelected ? selectedId.value : asset.id)
}

function onAssetClick(evt, asset) {
  if (justDragged) { justDragged = false; return }
  if (!props.editable) return
  if (pressedOnSelected) {
    // Click again on the selection → step one layer deeper, wrapping back
    // to the front after the backmost asset under the cursor.
    const ids = assetIdsAt(evt.clientX, evt.clientY)
    const idx = ids.indexOf(selectedId.value)
    if (ids.length > 1 && idx !== -1) {
      selectedId.value = ids[(idx + 1) % ids.length]
      return
    }
  }
  selectedId.value = asset.id
}

function startDrag(kind, id) {
  dragState = { kind, id }
  dragMoved = false
  if (kind === 'asset') selectedId.value = id
}

function startBackgroundPan(evt) {
  if (!props.editable || mode.value !== 'select') return
  dragState = {
    kind: 'backgroundPan',
    startY: evt.clientY,
    startOffset: props.vista.background_offset_y ?? 50
  }
  dragMoved = false
}

function startRotate(evt, asset) {
  const el = evt.currentTarget.closest('.vista-asset')
  if (!el) return
  const rect = el.getBoundingClientRect()
  dragState = { kind: 'rotate', id: asset.id, cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2 }
  dragMoved = false
  selectedId.value = asset.id
}

function startScale(evt, asset) {
  dragState = { kind: 'scale', id: asset.id, startX: evt.clientX, startWidthPct: asset.width_pct }
  dragMoved = false
  selectedId.value = asset.id
}

function onScaleWheel(evt, asset) {
  asset.width_pct = clamp(asset.width_pct - evt.deltaY * SCALE_WHEEL_SENSITIVITY, ASSET_SCALE_MIN, ASSET_SCALE_MAX)
  emitChange()
}

function onPointerMove(evt) {
  if (!dragState) return

  if (dragState.kind === 'backgroundPan') {
    dragMoved = true
    const range = verticalPanRangePx()
    if (range > 0) {
      const dy = evt.clientY - dragState.startY
      // Dragging down should drag the art down with the cursor (revealing
      // more of its top edge), which means the offset percentage decreases.
      const deltaPct = (dy / range) * 100
      props.vista.background_offset_y = clamp(dragState.startOffset - deltaPct, 0, 100)
    }
    return
  }

  if (dragState.kind === 'rotate') {
    dragMoved = true
    const asset = props.vista.assets.find(a => a.id === dragState.id)
    if (asset) {
      const angle = Math.atan2(evt.clientY - dragState.cy, evt.clientX - dragState.cx) * (180 / Math.PI) + 90
      asset.rotation = ((angle % 360) + 360) % 360
    }
    return
  }

  if (dragState.kind === 'scale') {
    dragMoved = true
    const asset = props.vista.assets.find(a => a.id === dragState.id)
    if (asset && frameRect.value.width) {
      // The box is horizontally centered on its anchor (translate(-50%, ...)),
      // so dragging the corner out by dx grows the total width by 2x that.
      const dx = evt.clientX - dragState.startX
      const scaleY = scaleForY(asset.y) || 1
      const deltaPct = ((dx * 2) / frameRect.value.width) * 100 / scaleY
      asset.width_pct = clamp(dragState.startWidthPct + deltaPct, ASSET_SCALE_MIN, ASSET_SCALE_MAX)
    }
    return
  }

  const pos = clientToPercent(evt)
  if (!pos) return
  dragMoved = true

  if (dragState.kind === 'asset') {
    const asset = props.vista.assets.find(a => a.id === dragState.id)
    if (asset) { asset.x = pos.x; asset.y = pos.y }
  } else if (dragState.kind === 'perspective') {
    const asset = props.vista.assets.find(a => a.id === dragState.id)
    if (asset) asset.depth_offset = pos.y - asset.y
  } else if (dragState.kind === 'vanishingPoint') {
    props.vista.vanishing_point.x = pos.x
    props.vista.vanishing_point.y = pos.y
  }
}

function onPointerUp() {
  if (dragState) {
    justDragged = dragMoved
    dragState = null
    if (dragMoved) emitChange()
  }
}

function deleteAsset(id) {
  props.vista.assets = props.vista.assets.filter(a => a.id !== id)
  selectedId.value = null
  emitChange()
}

function toggleFlip(asset) {
  asset.flip_h = !asset.flip_h
  emitChange()
}

function resetPerspective(asset) {
  asset.depth_offset = 0
  emitChange()
}

function resetAsset(asset) {
  asset.width_pct = 20
  asset.depth_offset = 0
  asset.flip_h = false
  asset.rotation = 0
  asset.opacity = 1
  asset.brightness = 1
  asset.saturation = 1
  asset.hue_rotate = 0
  emitChange()
}


</script>

<style scoped>
.vista-canvas {
  width: 100%;
  height: 100%;
  position: relative;
  background: radial-gradient(ellipse at 30% 40%, rgba(20, 15, 60, 0.9) 0%, rgba(5, 6, 20, 1) 60%, rgba(2, 3, 12, 1) 100%);
  overflow: hidden;
}

.empty-stage {
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

.empty-stage .mdi {
  font-size: 3rem;
  opacity: 0.5;
}

.stage-viewport {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  user-select: none;
  -webkit-user-select: none;
}

.stage-viewport.mode-asset {
  cursor: crosshair;
}

.stage-frame {
  position: absolute;
  overflow: hidden;
  /* Own stacking context: assets get depth-based z-indexes up to ~1100 (and
     the perspective handle 2000), which would otherwise outrank the toolbar
     and selection panel (600) and swallow clicks meant for them. */
  z-index: 0;
}

.stage-background {
  position: absolute;
  inset: 0;
  background-size: cover;
  background-position-x: center;
  background-repeat: no-repeat;
}

.stage-background.panning {
  cursor: ns-resize;
}

.stage-background.ambient {
  animation: vista-drift 40s ease-in-out infinite;
}

@media (prefers-reduced-motion: reduce) {
  .stage-background.ambient {
    animation: none;
  }
}

@keyframes vista-drift {
  0% { transform: scale(1); }
  50% { transform: scale(1.035); }
  100% { transform: scale(1); }
}

.vista-asset {
  position: absolute;
  transform: translate(-50%, -100%);
  cursor: pointer;
}

.vista-asset-spin {
  position: relative;
  width: 100%;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.vista-asset-image {
  width: 100%;
  height: auto;
  display: block;
  pointer-events: none;
}

.placeholder-icon {
  font-size: 2rem;
  color: rgba(226, 224, 235, 0.6);
  background: rgba(12, 13, 29, 0.6);
  border: 1px dashed var(--border-medium);
  border-radius: 50%;
  padding: 0.6em;
}

.vista-asset.selected .vista-asset-image,
.vista-asset.selected .placeholder-icon {
  outline: 2px solid var(--interactive-primary);
  outline-offset: 2px;
  border-radius: 4px;
}

.rotate-handle,
.scale-handle {
  position: absolute;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--interactive-primary);
  border: 2px solid white;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
  z-index: 700;
  pointer-events: auto;
}

.rotate-handle {
  top: 0;
  left: 50%;
  transform: translate(-50%, calc(-100% - 20px));
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 0.85rem;
  cursor: grab;
}

.rotate-handle:active {
  cursor: grabbing;
}

.rotate-handle::after {
  content: '';
  position: absolute;
  top: 100%;
  left: 50%;
  width: 2px;
  height: 20px;
  background: var(--interactive-primary);
  transform: translateX(-50%);
}

.scale-handle {
  bottom: 0;
  right: 0;
  transform: translate(50%, 50%);
  cursor: ns-resize;
}

.perspective-handle {
  position: absolute;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: rgba(12, 13, 29, 0.85);
  border: 2px solid #fbbf24;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
  transform: translate(-50%, -50%);
  cursor: ns-resize;
  z-index: 2000;
  touch-action: none;
}

.perspective-handle.forced {
  background: #fbbf24;
}

.perspective-guide {
  position: absolute;
  width: 0;
  border-left: 2px dashed rgba(251, 191, 36, 0.7);
  transform: translateX(-1px);
  pointer-events: none;
  z-index: 1999;
}

.vanishing-point {
  position: absolute;
  transform: translate(-50%, -50%);
  color: #22d3ee;
  font-size: 1.4rem;
  cursor: grab;
  opacity: 0.75;
  text-shadow: 0 0 6px rgba(34, 211, 238, 0.7);
  z-index: 500;
}

.vanishing-point:active {
  cursor: grabbing;
}

.vanishing-point:hover {
  opacity: 1;
}

.vista-toolbar {
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
  z-index: 600;
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

.asset-hint {
  position: absolute;
  pointer-events: none;
  bottom: 1rem;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(12, 13, 29, 0.9);
  border: 1px solid var(--border-medium);
  border-radius: 8px;
  padding: 0.5rem 1rem;
  color: var(--text-secondary);
  font-size: 0.8rem;
  z-index: 600;
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
  min-width: 240px;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  z-index: 600;
}

.selection-panel-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--text-secondary);
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

.panel-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.slider-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--text-secondary);
}

.slider-row input[type="range"] {
  flex: 1;
}

.slider-value {
  font-size: 0.75rem;
  min-width: 2.5em;
  text-align: right;
}

.flip-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  padding: 0.4rem 0.7rem;
  border-radius: 6px;
  border: 1px solid var(--border-light);
  background: transparent;
  color: var(--text-secondary);
  font-size: 0.8rem;
  cursor: pointer;
  align-self: flex-start;
}

.flip-btn.active {
  background: var(--interactive-primary);
  border-color: var(--interactive-primary);
  color: white;
}
</style>
