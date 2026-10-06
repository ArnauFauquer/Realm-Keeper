<template>
  <BattlemapCanvas
    :image-url="state.image_url"
    :grid="grid"
    :tokens="state.tokens"
    :editable="false"
    :zoomable="false"
    :reset-key="state.battlemap_id"
    :signals="signals"
  />
</template>

<script>
// A grid's default values, the same as backend models/battlemap.py's Grid:
// change them together.
export const GRID_DEFAULTS = Object.freeze({
  type: 'square',
  size: 70,
  offset_x: 0,
  offset_y: 0,
  snap: true,
  visible: true,
  color: '#ffffff',
  opacity: 0.25,
  distance: 1,
  unit: 'cell',
  measure: 'grid'
})
</script>

<script setup>
import { computed } from 'vue'
import BattlemapCanvas from './BattlemapCanvas.vue'

// The battlemap as /screen shows it: what the server projected for a screen
// (hidden tokens left out, each token with the counters it shows), drawn by
// the same canvas the table uses, with nothing to change and no zoom.
const props = defineProps({
  state: { type: Object, required: true },
  // The pings and pointers sent to the screen, over the map (utils/mapSignals.js).
  signals: { type: Object, default: null }
})

// A projection carries the grid's public fields; the rest take their usual values.
const grid = computed(() => ({ ...GRID_DEFAULTS, ...props.state.grid }))
</script>
