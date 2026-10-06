<template>
  <div class="constellation-screen">
    <canvas ref="canvas" class="constellation-canvas"></canvas>
    <div v-if="error" class="constellation-error">
      <span class="mdi mdi-graph-outline"></span>
      <p>Could not load the constellation</p>
    </div>
  </div>
</template>

<script setup>
/**
 * The constellation as the table sees it: a read-only mirror of the GM's. It
 * runs no physics of its own — the GM's layout is computed once, on the GM's
 * side, and its node positions, pan/zoom and highlights arrive in `state`
 * (the same shape for a frozen "send to screen" and for live updates).
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { fetchGraph } from '@/composables/useGraphData'
import { getNodeColor } from '@/config/nodeColors'
import {
  applyPositions,
  buildMirrorGraph,
  createConstellationCanvas,
  fitMirrorTransform
} from '@/composables/constellationCanvas'

const props = defineProps({
  state: { type: Object, required: true }
})

// How quickly the screen eases towards the GM's latest view each frame. Live
// updates arrive in steps; easing turns them into a smooth zoom/pan.
const EASE = 0.35
const SNAP_DISTANCE = 0.5
const SNAP_ZOOM = 0.002

const canvas = ref(null)
const error = ref(false)

let rawGraph = null
let nodes = []
let renderer = null
let current = null
let target = null
let easeFrame = 0

function easeStep() {
  easeFrame = 0
  if (!renderer || !target) return
  const dx = target.x - current.x
  const dy = target.y - current.y
  const dk = target.k - current.k
  const settled = Math.abs(dx) < SNAP_DISTANCE && Math.abs(dy) < SNAP_DISTANCE && Math.abs(dk / target.k) < SNAP_ZOOM
  current = settled
    ? { ...target }
    : { x: current.x + dx * EASE, y: current.y + dy * EASE, k: current.k + dk * EASE }
  renderer.setView(current)
  if (!settled) easeFrame = requestAnimationFrame(easeStep)
}

function moveViewTo(next, { jump = false } = {}) {
  target = next
  if (jump || !current) current = { ...next }
  if (jump) renderer.setView(current)
  else if (!easeFrame) easeFrame = requestAnimationFrame(easeStep)
}

function targetView() {
  const el = canvas.value
  return fitMirrorTransform(props.state.view, el.clientWidth, el.clientHeight)
}

function apply({ jump = false } = {}) {
  if (!renderer) return
  applyPositions(nodes, props.state.positions)
  renderer.setHighlightedType(props.state.highlighted_type ?? null)
  renderer.setHoverId(props.state.hover_id ?? null)
  moveViewTo(targetView(), { jump })
}

function start() {
  const graph = buildMirrorGraph(rawGraph.nodes, rawGraph.links, props.state.positions)
  nodes = graph.nodes
  renderer = createConstellationCanvas({
    canvas: canvas.value,
    nodes: graph.nodes,
    links: graph.links,
    getColor: getNodeColor,
    interactive: false,
    // A screen resized (or rotated) keeps showing the GM's region.
    onResize: () => { if (renderer) moveViewTo(targetView(), { jump: true }) }
  })
  apply({ jump: true })
}

onMounted(async () => {
  try {
    // Fresh: a screen is often opened long after the graph was last read.
    rawGraph = await fetchGraph({ fresh: true })
    start()
  } catch (err) {
    console.error('Failed to load constellation for screen:', err)
    error.value = true
  }
})

watch(() => props.state, () => apply())

onBeforeUnmount(() => {
  if (easeFrame) cancelAnimationFrame(easeFrame)
  renderer?.destroy()
  renderer = null
})
</script>

<style scoped>
.constellation-screen {
  position: relative;
  width: 100%;
  height: 100%;
}

.constellation-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.constellation-error {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  color: var(--text-secondary);
}

.constellation-error .mdi {
  font-size: 3rem;
  opacity: 0.6;
}
</style>
