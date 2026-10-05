<template>
  <div v-if="isOpen" class="rk-scrim" @click.self="closeModal">
    <div class="rk-dialog graph-modal-content" role="dialog" aria-modal="true" aria-labelledby="graph-modal-title">
      <div class="rk-dialog__header">
        <h2 id="graph-modal-title" class="rk-dialog__title"><span class="mdi mdi-graph-outline"></span> Constellation</h2>
        <div class="graph-header-actions">
          <template v-if="user && canShowOnScreen">
            <button
              class="rk-btn header-btn"
              :class="{ 'rk-btn--primary': live }"
              :aria-pressed="live"
              :title="live ? 'Stop mirroring the constellation on the screen' : 'Mirror your zoom, pan and highlights on the screen as you make them'"
              @click="toggleLive()"
            >
              <span class="mdi mdi-broadcast"></span>
              <span>{{ live ? 'Live' : 'Go live' }}</span>
            </button>
            <button
              class="rk-btn header-btn"
              :disabled="sendingToScreen"
              title="Show the constellation on the screen exactly as it is now"
              @click="sendToScreen"
            >
              <span class="mdi mdi-monitor-share"></span>
              <span>{{ sendingToScreen ? 'Sent!' : 'Send to screen' }}</span>
            </button>
          </template>
          <button class="rk-icon-btn" aria-label="Close constellation" @click="closeModal">
            <span class="mdi mdi-close"></span>
          </button>
        </div>
      </div>
      <div class="graph-body">
        <div class="graph-view">
    <div v-if="loading" class="graph-state" role="status">
      <span class="rk-spinner rk-spinner--lg"></span>
      <p>Loading constellation...</p>
    </div>

    <div v-else-if="error" class="graph-state">
      <div class="rk-alert" role="alert">
        <span class="mdi mdi-alert-circle-outline"></span>
        <span>{{ error }}</span>
      </div>
    </div>

    <div v-else-if="!nodes.length" class="graph-state rk-empty">
      <span class="mdi mdi-graph-outline"></span>
      <p>No notes to map yet.</p>
      <p class="rk-hint">Create notes and link them with [[wiki links]] to grow the constellation.</p>
    </div>

    <div v-else class="graph-container">
      <canvas ref="starCanvas" class="star-canvas"></canvas>
      <canvas ref="graphCanvas" class="graph-canvas" role="img" aria-label="Constellation of notes"></canvas>

      <!-- Mobile toggle button -->
      <button
        class="graph-info-toggle"
        :class="{ 'is-open': showGraphInfo }"
        @click="showGraphInfo = !showGraphInfo"
        aria-label="Toggle constellation info"
      >
        <span class="mdi mdi-information-outline"></span>
      </button>

      <div class="graph-info" :class="{ 'is-open': showGraphInfo }">
        <p>{{ nodes.length }} notes | {{ links.length }} connections</p>
        <button @click="showTypeStats = !showTypeStats" class="stats-toggle" :aria-expanded="showTypeStats">
          <span class="mdi" :class="showTypeStats ? 'mdi-chevron-down' : 'mdi-chevron-right'"></span> Tipos
        </button>
        <div v-if="showTypeStats" class="type-stats">
          <div
            v-for="(count, type) in typeStatistics"
            :key="type"
            class="type-stat-item"
            :class="{ 'is-selected': highlightedType === type }"
            @click="toggleTypeHighlight(type)"
          >
            <span class="type-color" :style="{ backgroundColor: getColorForTypeName(type) }"></span>
            <span class="type-name">{{ type || 'no type' }}</span>
            <span class="type-count">{{ count }}</span>
          </div>
        </div>
      </div>

      <!-- Settings toggle button -->
      <button
        class="graph-settings-toggle"
        :class="{ 'is-open': showForceSettings }"
        @click="showForceSettings = !showForceSettings"
        title="Constellation Settings"
        aria-label="Toggle constellation settings"
      >
        <span class="mdi mdi-cog"></span>
      </button>

      <div class="graph-settings" :class="{ 'is-open': showForceSettings }">
        <div class="settings-header">
          <h4>Layout Settings</h4>
          <button class="rk-icon-btn rk-icon-btn--sm" aria-label="Close layout settings" @click="showForceSettings = false">
            <span class="mdi mdi-close"></span>
          </button>
        </div>

        <div class="setting-group">
          <div class="setting-label">
            <label for="graph-link-distance">Link Distance</label>
            <span>{{ forceSettings.linkDistance }}</span>
          </div>
          <input id="graph-link-distance" type="range" min="1" max="150" v-model.number="forceSettings.linkDistance" @input="updateForces">
        </div>

        <div class="setting-group">
          <div class="setting-label">
            <label for="graph-charge">Node Repulsion</label>
            <span>{{ Math.abs(forceSettings.chargeStrength) }}</span>
          </div>
          <input id="graph-charge" type="range" min="10" max="1000" :value="Math.abs(forceSettings.chargeStrength)" @input="updateChargeStrength($event.target.value)">
        </div>


      </div>
    </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import * as d3 from 'd3'
import { markRaw, shallowRef, computed } from 'vue'
import { getCached } from '@/api/http'
import { apiUrl } from '@/config/env'
import { getNodeColor, getColorForType } from '../config/nodeColors'
import { drawStarfield } from '@/composables/useConstellationGraph'
import { createConstellationCanvas, decorateNodes } from '@/composables/constellationCanvas'
import { useLiveScreen } from '@/composables/useLiveScreen'
import { useAuth } from '@/composables/useAuth'
import { noteRoute } from '@/utils/noteUrls'

// Ticks run synchronously before the first paint so the graph appears almost
// settled instead of visibly exploding outwards.
const WARMUP_TICKS = 120

export default {
  name: 'GraphModal',
  props: {
    isOpen: {
      type: Boolean,
      required: true
    }
  },
  emits: ['close'],
  setup() {
    const { user } = useAuth()

    // The renderer owns the layout and view, so the screen's payload is read
    // from it at push time. `source` only exists so the live composable has
    // something to watch: it's replaced whenever the renderer reports a change.
    const liveBridge = { getSnapshot: null, changes: 0 }
    const source = shallowRef(null)
    const canShowOnScreen = computed(() => !!source.value)
    const snapshot = () => liveBridge.getSnapshot()
    const { live, sending: sendingToScreen, sendToScreen, toggle: toggleLive, stop: stopLive } = useLiveScreen(
      'constellation', source, snapshot, { buildShowPayload: snapshot }
    )

    function markChanged() {
      // Nothing to do while not mirroring; a send-to-screen reads fresh state.
      if (live.value && source.value) source.value = { id: 'constellation', changes: ++liveBridge.changes }
    }
    function setSource(isShown) {
      source.value = isShown ? { id: 'constellation', changes: 0 } : null
    }

    return {
      user, live, sendingToScreen, sendToScreen, toggleLive, stopLive,
      canShowOnScreen, liveBridge, markChanged, setSource
    }
  },
  data() {
    return {
      nodes: [],
      links: [],
      loading: true,
      error: null,
      showTypeStats: false,
      showGraphInfo: false,
      highlightedType: null,
      showForceSettings: false,
      forceSettings: {
        linkDistance: 30,
        chargeStrength: -200
      }
    }
  },
  computed: {
    typeStatistics() {
      const stats = {}
      this.nodes.forEach(node => {
        const type = node.type || ''
        stats[type] = (stats[type] || 0) + 1
      })
      return Object.fromEntries(
        Object.entries(stats).sort((a, b) => b[1] - a[1])
      )
    }
  },
  watch: {
    isOpen(newVal) {
      if (newVal) {
        if (this.nodes.length === 0) {
          this.fetchGraphData()
        } else {
          this.$nextTick(() => {
            this.initGraph()
          })
        }
      } else {
        this.teardownGraph()
      }
    }
  },
  created() {
    // Deliberately not in data(): the simulation mutates node positions on
    // every tick and Vue would wrap all of that in reactive proxies.
    this.graph = null
  },
  mounted() {
    if (this.isOpen) {
      this.fetchGraphData()
    }
  },
  beforeUnmount() {
    this.teardownGraph()
  },
  methods: {
    async fetchGraphData() {
      this.loading = true
      this.error = null
      
      try {
        const data = await getCached(`${apiUrl}/api/graph/all`, {
          useCache: true,
          cacheTtl: 600 // 10 minutos
        })

        if (!data || !data.nodes || !data.links) {
          throw new Error("Invalid graph data format returned from API")
        }

        // markRaw: d3 owns these objects and writes x/y into them every tick.
        this.nodes = markRaw(data.nodes.map(node => ({ ...node })))
        this.links = markRaw(data.links.map(link => ({ ...link })))
        this.loading = false
        
        this.$nextTick(() => {
          this.initGraph()
        })
      } catch (err) {
        this.error = err.response?.data?.detail || err.message
        this.loading = false
      }
    },
    
    initGraph() {
      const canvas = this.$refs.graphCanvas
      if (!canvas) return

      this.teardownGraph()

      const width = canvas.clientWidth
      const height = canvas.clientHeight

      // ── Starfield on its own canvas (drawn once, zero repaint cost) ───
      drawStarfield(this.$refs.starCanvas, width, height, {
        density: 6000,
        sizeRanges: [[0.3, 0.8], [0.8, 1.5], [1.5, 2.4]],
        opacityRange: [0.15, 0.55]
      })

      decorateNodes(this.nodes, this.links)

      const isFirstLayout = this.nodes.some(node => node.x === undefined)

      const simulation = d3.forceSimulation(this.nodes)
        .force('link', d3.forceLink(this.links)
          .id(d => d.id)
          .distance(this.forceSettings.linkDistance)
          .strength(0.08))
        .force('charge', d3.forceManyBody().strength(this.forceSettings.chargeStrength))
        .force('center', d3.forceCenter(width / 2, height / 2))
        .force('collision', d3.forceCollide().radius(d => (d.radius || 4) + 8))
        .alphaDecay(0.03)
        .velocityDecay(0.4)
        .stop()

      if (isFirstLayout) {
        simulation.tick(WARMUP_TICKS)
      } else {
        // Re-opened modal: keep the previous layout and only let it ease back in.
        simulation.alpha(0.1)
      }

      const renderer = createConstellationCanvas({
        canvas,
        simulation,
        nodes: this.nodes,
        links: this.links,
        getColor: node => this.getNodeColor(node),
        onNodeClick: node => this.onNodeClick(node),
        onChange: () => this.markChanged()
      })
      renderer.setHighlightedType(this.highlightedType)

      this.graph = { simulation, renderer }
      this.liveBridge.getSnapshot = renderer.getSnapshot
      this.setSource(true)
      simulation.restart()
    },

    teardownGraph() {
      // Leaving the modal ends mirroring; what the screen shows stays as it was.
      this.stopLive()
      this.setSource(false)
      this.liveBridge.getSnapshot = null
      if (!this.graph) return
      this.graph.simulation.stop()
      this.graph.renderer.destroy()
      this.graph = null
    },

    getNodeColor(node) {
      return getNodeColor(node)
    },
    
    getColorForTypeName(typeName) {
      return getColorForType(typeName)
    },
    
    onNodeClick(node) {
      this.closeModal()
      this.$router.push(noteRoute(node.id))
    },
    
    closeModal() {
      this.$emit('close')
    },

    toggleTypeHighlight(type) {
      this.highlightedType = this.highlightedType === type ? null : type
      this.graph?.renderer.setHighlightedType(this.highlightedType)
    },

    updateChargeStrength(value) {
      this.forceSettings.chargeStrength = -Number(value)
      this.updateForces()
    },
    
    updateForces() {
      const simulation = this.graph?.simulation
      if (!simulation) return

      simulation.force('link').distance(this.forceSettings.linkDistance)
      simulation.force('charge').strength(this.forceSettings.chargeStrength)
      simulation.force('collision').radius(d => (d.radius || d.size || 4) + 8)

      simulation.alpha(0.3).restart()
    }
  }
}
</script>

<style scoped>
/* Shell comes from .rk-scrim / .rk-dialog; only the canvas size lives here. */
.graph-header-actions {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: var(--space-2);
}

@media (max-width: 640px) {
  /* Icon-only actions on phones so the title keeps its room. */
  .graph-header-actions .header-btn span:not(.mdi) {
    display: none;
  }

  .graph-header-actions .header-btn {
    padding: 0 var(--space-3);
  }
}

.graph-modal-content {
  width: min(100%, 1400px);
  height: 90dvh;
}

.graph-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.graph-view {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: transparent;
}

.graph-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  padding: var(--space-6);
  color: var(--text-secondary);
  font-size: var(--text-sm);
}

.graph-state .rk-alert {
  max-width: 480px;
}

/* Deep-space backdrop is part of the constellation art, kept literal. */
.graph-container {
  flex: 1;
  position: relative;
  overflow: hidden;
  background: radial-gradient(ellipse at 30% 40%, rgba(20, 15, 60, 0.9) 0%, rgba(5, 6, 20, 1) 60%, rgba(2, 3, 12, 1) 100%);
}

.graph-canvas {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  cursor: grab;
  /* Let d3-zoom/d3-drag handle touch gestures instead of the browser scrolling. */
  touch-action: none;
}

.graph-canvas:active {
  cursor: grabbing;
}

/* No CSS animations — the scene is repainted on a single canvas */
.star-canvas {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

/* ── Floating panels ───────────────────────────────────────────── */
.graph-info,
.graph-settings {
  background: var(--surface-chrome);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid var(--accent-a30);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
  font-size: var(--text-sm);
  color: var(--text-secondary);
}

.graph-info {
  position: absolute;
  bottom: var(--space-6);
  left: var(--space-6);
  z-index: var(--z-raised);
  min-width: 220px;
  padding: var(--space-4);
}

.graph-info p {
  margin: 0 0 var(--space-3) 0;
  color: var(--text-primary);
  font-weight: 500;
  font-size: var(--text-md);
}

.stats-toggle {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  width: 100%;
  padding: var(--space-2);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--accent-hover);
  font-size: var(--text-sm);
  font-weight: 500;
  text-align: left;
  transition: background-color var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out);
}

.stats-toggle:hover {
  background: var(--hover-tint);
  color: var(--accent-soft);
}

.stats-toggle:active {
  background: var(--accent-a20);
}

.type-stats {
  margin-top: var(--space-3);
  padding-top: var(--space-3);
  border-top: 1px solid var(--border-light);
  max-height: 300px;
  overflow-y: auto;
}

.type-stat-item {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  padding: 0.375rem var(--space-2);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
  cursor: pointer;
  transition: background-color var(--duration-fast) var(--ease-out), border-color var(--duration-fast) var(--ease-out);
}

.type-stat-item:hover {
  background: var(--hover-tint);
}

.type-stat-item:active {
  background: var(--accent-a20);
}

.type-stat-item.is-selected {
  background: var(--accent-a20);
  border-color: var(--accent-a45);
}

.type-color {
  width: 10px;
  height: 10px;
  flex-shrink: 0;
  border-radius: var(--radius-full);
  border: 1px solid var(--border-medium);
}

.type-name {
  flex: 1;
  color: var(--text-primary);
  font-style: italic;
}

.type-count {
  min-width: 32px;
  text-align: right;
  font-family: var(--font-mono);
  font-weight: 600;
  color: var(--text-secondary);
}

/* ── Mobile info toggle ────────────────────────────────────────── */
.graph-info-toggle {
  display: none;
  position: fixed;
  bottom: calc(var(--mobile-bar-height) + var(--space-4) + env(safe-area-inset-bottom, 0px));
  left: var(--space-6);
  z-index: var(--z-sticky);
  width: 56px;
  height: 56px;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-full);
  background: linear-gradient(135deg, var(--accent) 0%, #6366f1 100%);
  box-shadow: var(--shadow-accent);
  transition: transform var(--duration-base) var(--ease-out), background-color var(--duration-base) var(--ease-out);
}

.graph-info-toggle .mdi {
  font-size: 1.5rem;
  color: var(--accent-contrast);
}

.graph-info-toggle:hover {
  transform: scale(1.05);
}

.graph-info-toggle:active {
  transform: scale(0.95);
}

.graph-info-toggle.is-open {
  background: var(--surface-raised-hover);
}

/* ── Settings ──────────────────────────────────────────────────── */
.graph-settings-toggle {
  position: absolute;
  top: var(--space-6);
  right: var(--space-6);
  z-index: var(--z-sticky);
  width: var(--control-lg);
  height: var(--control-lg);
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--accent-a30);
  border-radius: var(--radius-full);
  background: var(--surface-raised-hover);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  box-shadow: var(--shadow-md);
  transition:
    background-color var(--duration-fast) var(--ease-out),
    border-color var(--duration-fast) var(--ease-out),
    transform var(--duration-fast) var(--ease-out);
}

.graph-settings-toggle .mdi {
  font-size: 1.25rem;
  color: var(--text-primary);
  transition: transform var(--duration-base) var(--ease-out);
}

.graph-settings-toggle:hover {
  border-color: var(--accent);
  transform: scale(1.05);
}

.graph-settings-toggle:active {
  transform: scale(0.95);
}

.graph-settings-toggle.is-open .mdi {
  transform: rotate(90deg);
}

.graph-settings {
  position: absolute;
  top: calc(var(--space-6) + var(--control-lg) + var(--space-2));
  right: var(--space-6);
  z-index: var(--z-raised);
  min-width: 260px;
  padding: var(--space-5);
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  opacity: 0;
  pointer-events: none;
  transform: translateY(-10px);
  transition: opacity var(--duration-base) var(--ease-out), transform var(--duration-base) var(--ease-out);
}

.graph-settings.is-open {
  opacity: 1;
  pointer-events: auto;
  transform: translateY(0);
}

.settings-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: var(--space-3);
  border-bottom: 1px solid var(--border-medium);
}

.settings-header h4 {
  margin: 0;
  color: var(--text-primary);
  font-size: var(--text-md);
  font-weight: 600;
}

.setting-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.setting-label {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: var(--text-sm);
  color: var(--text-secondary);
}

.setting-label span {
  font-family: var(--font-mono);
  font-weight: 600;
  color: var(--accent-hover);
}

.setting-group input[type="range"] {
  width: 100%;
  accent-color: var(--accent);
  cursor: pointer;
}

@media (max-width: 768px) {
  .graph-info-toggle {
    display: flex;
  }

  .graph-info {
    position: fixed;
    bottom: calc(var(--mobile-bar-height) + 5rem + env(safe-area-inset-bottom, 0px));
    left: var(--space-6);
    right: auto;
    max-width: calc(100vw - 3rem);
    min-width: 200px;
    transform: scale(0);
    transform-origin: bottom left;
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--duration-base) var(--ease-out), transform var(--duration-base) var(--ease-out);
  }

  .graph-info.is-open {
    transform: scale(1);
    opacity: 1;
    pointer-events: auto;
  }

  .type-stats {
    max-height: 200px;
  }

  .graph-settings-toggle {
    top: var(--space-4);
    right: var(--space-4);
  }

  .graph-settings {
    top: calc(var(--space-4) + var(--control-lg) + var(--space-2));
    right: var(--space-4);
    max-width: calc(100vw - 2rem);
  }
}
</style>
