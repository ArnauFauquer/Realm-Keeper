<template>
  <div class="dice-overlay" :class="{ visible: state.overlayVisible }" aria-hidden="true">
    <canvas ref="canvasRef"></canvas>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useDiceRoller } from '@/composables/useDiceRoller'

const { state, registerCanvas, resizeWorld, disposeWorld } = useDiceRoller()
const canvasRef = ref(null)

function handleResize() {
  if (!canvasRef.value) return
  const rect = canvasRef.value.getBoundingClientRect()
  resizeWorld(rect.width, rect.height)
}

onMounted(() => {
  registerCanvas(canvasRef.value)
  window.addEventListener('resize', handleResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
  disposeWorld()
})
</script>

<style scoped>
.dice-overlay {
  position: fixed;
  inset: 0;
  z-index: 3000;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.4s ease;
}

.dice-overlay.visible {
  opacity: 1;
}

.dice-overlay canvas {
  width: 100%;
  height: 100%;
  display: block;
}
</style>
