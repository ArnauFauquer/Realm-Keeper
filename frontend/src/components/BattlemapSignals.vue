<template>
  <g class="map-signals" pointer-events="none">
    <!-- Someone else measuring, or moving a token: the path, and the token's
         ghost at its end until it is let go of. -->
    <g v-for="ruler in frame.rulers" :key="ruler.key" class="remote-ruler">
      <MeasurePath :grid="grid" :points="ruler.points.map((p) => px(p.x, p.y))" :color="ruler.color" :by="ruler.by" :opacity="ruler.opacity" />
      <BattlemapToken
        v-if="ruler.token && !ruler.ended && tokenById(ruler.token)"
        :token="tokenById(ruler.token)"
        :cell="grid.size"
        :clip-id="ghostClipId(ruler.key)"
        ghost
        :transform="`translate(${px(ruler.points.at(-1).x, ruler.points.at(-1).y).x}, ${px(ruler.points.at(-1).x, ruler.points.at(-1).y).y})`"
      />
    </g>

    <!-- The pointer: a trail fading behind a bright head. -->
    <g v-for="stroke in frame.strokes" :key="stroke.key" class="pointer" :style="{ '--signal': stroke.color }">
      <line
        v-for="(s, i) in stroke.segments"
        :key="i"
        class="pointer-glow"
        :x1="px(s.x1, s.y1).x" :y1="px(s.x1, s.y1).y" :x2="px(s.x2, s.y2).x" :y2="px(s.x2, s.y2).y"
        :stroke-width="trailWidth * 3"
        :opacity="s.opacity * 0.5"
      />
      <line
        v-for="(s, i) in stroke.segments"
        :key="`core${i}`"
        class="pointer-core"
        :x1="px(s.x1, s.y1).x" :y1="px(s.x1, s.y1).y" :x2="px(s.x2, s.y2).x" :y2="px(s.x2, s.y2).y"
        :stroke-width="trailWidth"
        :opacity="s.opacity"
      />
      <g v-if="stroke.head" :transform="`translate(${px(stroke.head.x, stroke.head.y).x}, ${px(stroke.head.x, stroke.head.y).y})`">
        <circle class="pointer-halo" :r="trailWidth * 3.2" />
        <circle class="pointer-head" :r="trailWidth * 1.4" />
        <text v-if="stroke.by" class="signal-name" :font-size="nameSize" :x="trailWidth * 4" :y="-trailWidth * 3">{{ stroke.by }}</text>
      </g>
    </g>

    <!-- A ping: rings spreading from the point, once. -->
    <g
      v-for="ping in frame.pings"
      :key="ping.id"
      class="ping"
      :style="{ '--signal': ping.color }"
      :transform="`translate(${px(ping.x, ping.y).x}, ${px(ping.x, ping.y).y})`"
    >
      <circle class="ping-ring" :r="cell * 1.4" :stroke-width="trailWidth * 1.2" />
      <circle class="ping-ring ping-ring--late" :r="cell * 1.4" :stroke-width="trailWidth * 1.2" />
      <circle class="ping-dot" :r="trailWidth * 1.6" :opacity="1 - ping.progress" />
      <text v-if="ping.by" class="signal-name" :font-size="nameSize" text-anchor="middle" :y="trailWidth * 2.5 + nameSize" :opacity="1 - ping.progress">{{ ping.by }}</text>
    </g>

    <!-- A roll over its token: what for and the total, for a few seconds. -->
    <g
      v-for="r in rollBubbles"
      :key="r.id"
      class="roll"
      :style="{ '--signal': r.color }"
      :transform="`translate(${r.x}, ${r.y})`"
      :opacity="r.progress > 0.85 ? (1 - r.progress) / 0.15 : 1"
    >
      <rect class="roll-back" :x="-r.width / 2" :y="-rollSize * 1.7" :width="r.width" :height="rollSize * 1.7" :rx="rollSize * 0.85" />
      <text class="roll-text" :font-size="rollSize" text-anchor="middle" :y="-rollSize * 0.55">
        <tspan v-if="r.label" class="roll-label">{{ r.label }}</tspan>
        <tspan class="roll-total" :dx="r.label ? rollSize * 0.4 : 0">{{ r.total }}</tspan>
      </text>
      <title>{{ r.formula }}: {{ r.total }}</title>
    </g>
  </g>
</template>

<script setup>
import { computed, onBeforeUnmount, shallowRef, watch } from 'vue'
import BattlemapToken from './BattlemapToken.vue'
import MeasurePath from './MeasurePath.vue'
import { toPixels, tokenCenter } from '@/utils/battlemapGeometry'

// What is pointed at on the map, drawn over it (inside the map's SVG, so it
// zooms with it): the pointers' trails, pings and rolls over tokens of a
// signal layer (utils/mapSignals.js), and the rulers and token moves of
// everyone else. It redraws every frame while anything
// is showing, and not at all otherwise; only this part of the map does.
const props = defineProps({
  layer: { type: Object, required: true },
  grid: { type: Object, required: true },
  // The tokens rolls are shown over, and moving ones' ghosts are drawn as.
  tokens: { type: Array, default: () => [] }
})

const EMPTY = Object.freeze({ pings: [], strokes: [], rolls: [], rulers: [] })
const uid = Math.random().toString(36).slice(2, 8)
// A ruler's key carries who measures ("Local User", with its spaces and bars),
// and an id with those in it is no id a clip path can be found by: the token's
// picture would show whole. Each such character is spelled out instead, so
// the ids stay apart.
const ghostClipId = (key) => `ghost-${uid}-${key.replace(/[^A-Za-z0-9_-]/g, (c) => `_${c.charCodeAt(0).toString(16)}`)}`
const tokenById = (id) => props.tokens.find((t) => t.id === id) || null
const frame = shallowRef(EMPTY)

const cell = computed(() => props.grid.size)
const trailWidth = computed(() => Math.max(4, cell.value * 0.09))
const nameSize = computed(() => Math.max(11, cell.value * 0.22))
const rollSize = computed(() => Math.max(12, cell.value * 0.28))
const px = (x, y) => toPixels(props.grid, x, y)

// Over the token's name (which sits above it), so neither hides the other.
const rollBubbles = computed(() => frame.value.rolls.flatMap((r) => {
  const token = props.tokens.find((t) => t.id === r.token)
  if (!token) return []
  const center = tokenCenter(props.grid, token)
  const label = r.label.length > 24 ? `${r.label.slice(0, 23)}…` : r.label
  const chars = label.length + String(r.total).length + (label ? 1 : 0)
  return [{
    ...r,
    label,
    x: center.x,
    y: center.y - ((token.size ?? 1) * cell.value) / 2 - nameSize.value * 1.4,
    width: chars * rollSize.value * 0.62 + rollSize.value * 1.4
  }]
}))

let raf = null

function tick() {
  const at = performance.now()
  props.layer.prune(at)
  frame.value = props.layer.view(at)
  raf = props.layer.idle() ? null : requestAnimationFrame(tick)
}

function wake() {
  if (raf === null) raf = requestAnimationFrame(tick)
}

let unsubscribe = null
watch(() => props.layer, (layer) => {
  unsubscribe?.()
  unsubscribe = layer.subscribe(wake)
  wake()
}, { immediate: true })

onBeforeUnmount(() => {
  unsubscribe?.()
  if (raf !== null) cancelAnimationFrame(raf)
})
</script>

<style scoped>
.pointer-glow,
.pointer-core {
  stroke: var(--signal);
  stroke-linecap: round;
}

.pointer-halo {
  fill: var(--signal);
  opacity: 0.3;
}

.pointer-head {
  fill: #fff;
  stroke: var(--signal);
  stroke-width: 3;
}

.signal-name {
  fill: #fff;
  font-weight: 600;
  paint-order: stroke;
  stroke: rgba(0, 0, 0, 0.85);
  stroke-width: 3px;
  stroke-linejoin: round;
}

.ping-ring {
  fill: none;
  stroke: var(--signal);
  transform-box: fill-box;
  transform-origin: center;
  animation: ping-spread 1.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

.ping-ring--late {
  opacity: 0;
  animation-delay: 0.35s;
}

.ping-dot {
  fill: var(--signal);
  stroke: #fff;
  stroke-width: 2;
}

@keyframes ping-spread {
  from {
    transform: scale(0.1);
    opacity: 1;
  }
  to {
    transform: scale(1);
    opacity: 0;
  }
}

/* It spreads even when the device asks for reduced motion (on Windows, with
   "Animation effects" off): a ping is there to catch the eye, once, briefly.
   (styles/base.css cuts every animation short then, with !important.) */
@media (prefers-reduced-motion: reduce) {
  .ping-ring {
    animation-duration: 1.2s !important;
  }
}

.roll-back {
  fill: rgba(12, 13, 29, 0.92);
  stroke: var(--signal);
  stroke-width: 2;
}

.roll-text {
  fill: #fff;
}

.roll-label {
  fill: rgba(255, 255, 255, 0.78);
  font-weight: 500;
}

.roll-total {
  font-weight: 800;
}
</style>
