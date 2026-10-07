<template>
  <div class="token-image-editor">
    <div
      class="frame"
      :class="{ disabled }"
      :style="{ '--frame-color': color || '#6d4fc2' }"
      role="img"
      :aria-label="disabled ? 'The token\'s image' : 'The token\'s image: drag to move it, scroll to zoom'"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onUp"
      @wheel.prevent="onWheel"
    >
      <div class="turn" :style="{ transform: `rotate(${draft.rotation}deg)` }">
        <img :src="src" alt="" draggable="false" :style="imageStyle" />
      </div>
    </div>

    <div class="controls">
      <label class="slider">
        <span class="mdi mdi-magnify-plus-outline" aria-hidden="true"></span>
        <input type="range" min="0.2" max="5" step="0.05" :value="draft.scale" :disabled="disabled" aria-label="Zoom the image" @input="draft.scale = Number($event.target.value)" @change="commit" />
      </label>
      <label class="slider">
        <span class="mdi mdi-rotate-right" aria-hidden="true"></span>
        <input type="range" min="-180" max="180" step="5" :value="draft.rotation" :disabled="disabled" aria-label="Turn the token" @input="draft.rotation = Number($event.target.value)" @change="commit" />
      </label>
      <button type="button" class="rk-btn rk-btn--sm" :disabled="disabled || isReset" @click="reset">
        <span class="mdi mdi-backup-restore"></span> Reset
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed, reactive, watch } from 'vue'
import { resolveUrl } from '@/utils/resolveUrl'

// How a token's image sits in it: dragged to frame a face, zoomed, turned.
// The token keeps `image_scale` (1 fills it), `image_x`, `image_y` (moved by
// that many token widths) and `rotation` (degrees): the same the map draws
// (utils/battlemapGeometry.js tokenImageFrame). Changes are shown here as they
// are made and asked for (`change`, with what changed) once let go of.
const props = defineProps({
  imageUrl: { type: String, required: true },
  scale: { type: Number, default: 1 },
  x: { type: Number, default: 0 },
  y: { type: Number, default: 0 },
  rotation: { type: Number, default: 0 },
  color: { type: String, default: null },
  disabled: { type: Boolean, default: false }
})

const emit = defineEmits(['change'])

const clamp = (value, low, high) => Math.min(high, Math.max(low, value))
const round = (value) => Math.round(value * 1000) / 1000

const draft = reactive({ scale: 1, x: 0, y: 0, rotation: 0 })
// The frame being dragged: { id, x, y, from, width }.
let drag = null
// What the token has, until it is changed here.
watch(() => [props.scale, props.x, props.y, props.rotation], () => {
  if (drag) return
  Object.assign(draft, { scale: props.scale ?? 1, x: props.x ?? 0, y: props.y ?? 0, rotation: props.rotation ?? 0 })
}, { immediate: true })

const src = computed(() => resolveUrl(props.imageUrl))
const isReset = computed(() => draft.scale === 1 && draft.x === 0 && draft.y === 0 && draft.rotation === 0)
// As the map draws it: a square as wide as the token times the zoom,
// centred, then moved.
const imageStyle = computed(() => ({
  width: `${draft.scale * 100}%`,
  height: `${draft.scale * 100}%`,
  left: `${50 - draft.scale * 50 + draft.x * 100}%`,
  top: `${50 - draft.scale * 50 + draft.y * 100}%`
}))

function commit() {
  const changed = {}
  if (draft.scale !== props.scale) changed.image_scale = round(draft.scale)
  if (draft.x !== props.x) changed.image_x = round(draft.x)
  if (draft.y !== props.y) changed.image_y = round(draft.y)
  if (draft.rotation !== props.rotation) changed.rotation = draft.rotation
  if (Object.keys(changed).length) emit('change', changed)
}

function reset() {
  Object.assign(draft, { scale: 1, x: 0, y: 0, rotation: 0 })
  commit()
}

// Dragged by the frame: the image follows the pointer, in token widths. A
// turned token is moved the way it faces, as the map would show it.

function onDown(event) {
  if (props.disabled || event.button !== 0) return
  try {
    event.currentTarget.setPointerCapture?.(event.pointerId)
  } catch {
    // A pointer already gone (or a synthetic one) has nothing to capture.
  }
  drag = { id: event.pointerId, x: event.clientX, y: event.clientY, from: { x: draft.x, y: draft.y }, width: event.currentTarget.clientWidth || 1 }
}

function onMove(event) {
  if (!drag || event.pointerId !== drag.id) return
  const turn = (-draft.rotation * Math.PI) / 180
  const dx = (event.clientX - drag.x) / drag.width
  const dy = (event.clientY - drag.y) / drag.width
  draft.x = clamp(drag.from.x + dx * Math.cos(turn) - dy * Math.sin(turn), -1, 1)
  draft.y = clamp(drag.from.y + dx * Math.sin(turn) + dy * Math.cos(turn), -1, 1)
}

function onUp(event) {
  if (!drag || event.pointerId !== drag.id) return
  drag = null
  commit()
}

let wheelTimer = null
function onWheel(event) {
  if (props.disabled) return
  draft.scale = clamp(Math.round((draft.scale * (event.deltaY < 0 ? 1.1 : 1 / 1.1)) * 100) / 100, 0.2, 5)
  clearTimeout(wheelTimer)
  wheelTimer = setTimeout(commit, 300)
}
</script>

<style scoped>
.token-image-editor {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.frame {
  position: relative;
  flex: none;
  width: 6rem;
  height: 6rem;
  overflow: hidden;
  border-radius: var(--radius-full);
  border: 3px solid rgba(255, 255, 255, 0.85);
  background: var(--frame-color);
  cursor: grab;
  touch-action: none;
}

.frame:active {
  cursor: grabbing;
}

.frame.disabled {
  cursor: default;
}

.turn {
  position: absolute;
  inset: 0;
}

.turn img {
  position: absolute;
  object-fit: cover;
  pointer-events: none;
  user-select: none;
}

.controls {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  align-items: flex-start;
}

.slider {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  color: var(--text-muted);
}

.slider input {
  flex: 1;
  min-width: 0;
}
</style>
