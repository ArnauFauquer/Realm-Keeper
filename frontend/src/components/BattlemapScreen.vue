<template>
  <BattlemapCanvas
    :image-url="state.image_url"
    :grid="grid"
    :tokens="state.tokens"
    :editable="false"
    :zoomable="false"
    :reset-key="state.battlemap_id"
  />
</template>

<script setup>
import { computed } from 'vue'
import BattlemapCanvas from './BattlemapCanvas.vue'

// The battlemap as /screen shows it: what the server projected for a screen
// (hidden tokens left out, each token with the counters it shows), drawn by
// the same canvas the table uses, with nothing to change and no zoom.
const props = defineProps({
  state: { type: Object, required: true }
})

// A projection carries the grid's public fields; the rest take their usual values.
const grid = computed(() => ({
  type: 'square', size: 70, offset_x: 0, offset_y: 0, visible: true, color: '#ffffff', opacity: 0.25,
  distance: 1, unit: 'cell', measure: 'grid',
  ...props.state.grid
}))
</script>
