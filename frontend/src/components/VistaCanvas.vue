<template>
  <div class="vista-canvas" :class="{ editable }">
    <div v-if="!vista.background_url" class="empty-stage">
      <span class="mdi mdi-image-plus"></span>
      <p v-if="editable">Upload a background image to start this vista.</p>
      <p v-else>This vista has no background yet.</p>
      <label v-if="editable" class="upload-btn">
        <span class="mdi mdi-upload"></span> Upload background
        <input type="file" accept="image/*" hidden @change="onBackgroundSelected" />
      </label>
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
        <div class="stage-background" :class="{ ambient: !editable }" :style="backgroundStyle"></div>

        <!-- Assets, painter's-algorithm ordered: farther (smaller y) behind, nearer (larger y) in front -->
        <div
          v-for="asset in orderedAssets"
          :key="asset.id"
          class="vista-asset"
          :class="{ selected: selectedId === asset.id, 'no-image': !asset.image_url }"
          :style="assetStyle(asset)"
          @pointerdown.stop="editable && startDrag('asset', asset.id)"
          @click.stop="onAssetClick(asset)"
          @mousedown.stop.prevent
          @touchstart.stop
        >
          <img
            v-if="asset.image_url"
            :src="resolveUrl(asset.image_url)"
            :alt="asset.name"
            class="vista-asset-image"
            :class="{ flipped: asset.flip_h }"
            draggable="false"
          />
          <span v-else class="mdi mdi-account-outline placeholder-icon"></span>
        </div>

        <!-- Vanishing point marker -->
        <div
          v-if="editable"
          class="vanishing-point"
          :style="vanishingPointStyle"
          title="Vanishing point — drag to calibrate perspective for this background"
          @pointerdown.stop="startDrag('vanishingPoint', null)"
          @click.stop
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
        <label class="tool-btn" title="Replace background">
          <span class="mdi mdi-image-edit-outline"></span>
          <input type="file" accept="image/*" hidden @change="onBackgroundSelected" />
        </label>
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

        <button class="upload-btn small" @click="openLibraryForAsset(selectedAsset)">
          <span class="mdi mdi-folder-multiple-image"></span> {{ selectedAsset.image_url ? 'Change image' : 'Choose image' }}
        </button>

        <div class="size-control">
          <span class="mdi mdi-arrow-expand-horizontal"></span>
          <input
            type="range"
            min="4" max="60" step="1"
            v-model.number="selectedAsset.width_pct"
            @input="emitChange"
          />
          <span class="size-value">{{ Math.round(selectedAsset.width_pct) }}%</span>
        </div>

        <button class="flip-btn" :class="{ active: selectedAsset.flip_h }" @click="toggleFlip(selectedAsset)">
          <span class="mdi mdi-flip-horizontal"></span> Flip
        </button>
      </div>
    </div>

    <AssetLibraryModal
      :is-open="libraryModalOpen"
      @close="libraryModalOpen = false"
      @select="onLibrarySelect"
    />
  </div>
</template>

<script setup>
import { ref, computed, watch, onBeforeUnmount, nextTick } from 'vue'
import { apiUrl } from '@/config/env'
import AssetLibraryModal from './AssetLibraryModal.vue'

const props = defineProps({
  vista: { type: Object, required: true },
  editable: { type: Boolean, default: false }
})

const emit = defineEmits(['change', 'upload-background'])

const libraryModalOpen = ref(false)
const pendingLibraryItem = ref(null)
let libraryTargetAsset = null

// A distant asset never shrinks below this fraction of its base size — keeps
// far-away characters visible instead of vanishing to a single pixel.
const MIN_SCALE = 0.06
const GROUND_Y = 100

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

function resolveUrl(url) {
  if (!url) return url
  return url.startsWith('http') ? url : `${apiUrl}${url}`
}

const backgroundStyle = computed(() => ({
  backgroundImage: props.vista.background_url ? `url(${resolveUrl(props.vista.background_url)})` : 'none'
}))

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

function assetStyle(asset) {
  const widthPct = asset.width_pct * scaleForY(asset.y)
  return {
    left: `${asset.x}%`,
    top: `${asset.y}%`,
    width: `${widthPct}%`,
    zIndex: 100 + Math.round(asset.y * 10)
  }
}

const orderedAssets = computed(() => [...props.vista.assets].sort((a, b) => a.y - b.y))

const vanishingPointStyle = computed(() => ({
  left: `${props.vista.vanishing_point?.x ?? 50}%`,
  top: `${props.vista.vanishing_point?.y ?? 40}%`
}))

const selectedAsset = computed(() => props.vista.assets.find(a => a.id === selectedId.value) || null)

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function emitChange() {
  emit('change', {
    vanishing_point: props.vista.vanishing_point,
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
  libraryModalOpen.value = true
}

function openLibraryForAsset(asset) {
  libraryTargetAsset = asset
  libraryModalOpen.value = true
}

function onLibrarySelect(item) {
  libraryModalOpen.value = false
  if (libraryTargetAsset) {
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
  if (mode.value !== 'asset') {
    selectedId.value = null
    return
  }
  if (!pendingLibraryItem.value) return
  const pos = clientToPercent(evt)
  if (!pos) return
  const item = pendingLibraryItem.value
  const asset = { id: uuid(), name: item.name, image_url: item.image_url, x: pos.x, y: pos.y, width_pct: 20, flip_h: false }
  props.vista.assets.push(asset)
  pendingLibraryItem.value = null
  emitChange()
  mode.value = 'select'
  selectedId.value = asset.id
}

function onAssetClick(asset) {
  if (dragMoved) return
  if (props.editable) {
    selectedId.value = asset.id
  }
}

function startDrag(kind, id) {
  dragState = { kind, id }
  dragMoved = false
  if (kind === 'asset') selectedId.value = id
}

function onPointerMove(evt) {
  if (!dragState) return
  const pos = clientToPercent(evt)
  if (!pos) return
  dragMoved = true

  if (dragState.kind === 'asset') {
    const asset = props.vista.assets.find(a => a.id === dragState.id)
    if (asset) { asset.x = pos.x; asset.y = pos.y }
  } else if (dragState.kind === 'vanishingPoint') {
    props.vista.vanishing_point.x = pos.x
    props.vista.vanishing_point.y = pos.y
  }
}

function onPointerUp() {
  if (dragState) {
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

function onBackgroundSelected(evt) {
  const file = evt.target.files[0]
  if (file) emit('upload-background', file)
  evt.target.value = ''
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
}

.stage-background {
  position: absolute;
  inset: 0;
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
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
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.vista-asset-image {
  width: 100%;
  height: auto;
  display: block;
  filter: drop-shadow(0 6px 10px rgba(0, 0, 0, 0.45));
  pointer-events: none;
}

.vista-asset-image.flipped {
  transform: scaleX(-1);
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

.size-control {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--text-secondary);
}

.size-control input[type="range"] {
  flex: 1;
}

.size-value {
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
