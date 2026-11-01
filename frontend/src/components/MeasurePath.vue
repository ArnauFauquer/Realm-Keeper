<template>
  <g class="measure" :style="{ '--measure': color }" :opacity="opacity" pointer-events="none">
    <!-- On a map measured in bands: each band's reach around where it starts,
         the one it ends in drawn whole. -->
    <g v-for="ring in rings" :key="ring.name" class="band" :class="{ current: ring.name === measured.band?.name }">
      <circle class="band-ring" :cx="start.x" :cy="start.y" :r="ring.r" :stroke-width="ring.name === measured.band?.name ? lineWidth : lineWidth * 0.6" />
      <text class="band-name" :x="start.x" :y="start.y - ring.r - labelSize * 0.35" :font-size="labelSize * 0.8" text-anchor="middle">{{ ring.name }}</text>
    </g>

    <polyline class="measure-line" :points="points.map((p) => `${p.x},${p.y}`).join(' ')" :stroke-width="lineWidth" />
    <circle v-for="(p, i) in points.slice(1, -1)" :key="i" class="measure-turn" :cx="p.x" :cy="p.y" :r="lineWidth * 1.6" />
    <circle class="measure-end" :cx="start.x" :cy="start.y" :r="lineWidth * 1.6" />
    <circle class="measure-end" :cx="end.x" :cy="end.y" :r="lineWidth * 1.6" />

    <!-- Up and right of the end, clear of a token's ghost there. -->
    <g :transform="`translate(${end.x + grid.size * 0.6}, ${end.y - grid.size * 0.6 - boxHeight})`">
      <rect class="measure-back" :width="boxWidth" :height="boxHeight" :rx="labelSize * 0.3" />
      <text class="measure-label" :font-size="labelSize" :x="labelSize * 0.5" :y="labelSize * 1.2">{{ measured.label }}</text>
      <text v-if="by" class="measure-by" :font-size="labelSize * 0.62" :x="labelSize * 0.5" :y="labelSize * 2.1">{{ by }}</text>
    </g>
  </g>
</template>

<script setup>
import { computed } from 'vue'
import { bandRings, measurePath } from '@/utils/battlemapGeometry'

// A measured path on a battlemap: where it starts, its turns, where it ends
// (in pixels of the map), and how far that is as the table counts it. The
// ruler, a token being moved and someone else's ruler all draw it the same.
const props = defineProps({
  grid: { type: Object, required: true },
  points: { type: Array, required: true },
  color: { type: String, default: '#fbbf24' },
  // Whose it is, under the distance (someone else's ruler).
  by: { type: String, default: null },
  opacity: { type: Number, default: 1 }
})

const start = computed(() => props.points[0])
const end = computed(() => props.points[props.points.length - 1])
const measured = computed(() => measurePath(props.grid, props.points))
const rings = computed(() => bandRings(props.grid))

const lineWidth = computed(() => Math.max(3, props.grid.size * 0.075))
const labelSize = computed(() => Math.max(14, props.grid.size * 0.34))
const boxHeight = computed(() => labelSize.value * (props.by ? 2.6 : 1.7))
const boxWidth = computed(() => {
  const chars = Math.max(measured.value.label.length, props.by ? props.by.length * 0.62 : 0)
  return chars * labelSize.value * 0.6 + labelSize.value
})
</script>

<style scoped>
.measure-line {
  fill: none;
  stroke: var(--measure);
  stroke-linecap: round;
  stroke-linejoin: round;
}

.measure-turn,
.measure-end {
  fill: var(--measure);
  stroke: rgba(12, 13, 29, 0.8);
  stroke-width: 1.5;
}

.measure-back {
  fill: rgba(12, 13, 29, 0.9);
  stroke: var(--measure);
  stroke-width: 1.5;
}

.measure-label {
  fill: #fff;
  font-weight: 700;
}

.measure-by {
  fill: rgba(255, 255, 255, 0.72);
  font-weight: 500;
}

.band-ring {
  fill: none;
  stroke: var(--measure);
  stroke-dasharray: 8 6;
  opacity: 0.45;
}

/* The band it ends in: its ring drawn whole, nothing filled (a far band
   would cover the map). */
.band.current .band-ring {
  stroke-dasharray: none;
  opacity: 0.9;
}

.band-name {
  fill: #fff;
  font-weight: 600;
  opacity: 0.7;
  paint-order: stroke;
  stroke: rgba(0, 0, 0, 0.8);
  stroke-width: 3px;
  stroke-linejoin: round;
}

.band.current .band-name {
  opacity: 1;
}
</style>
