<template>
  <div v-if="isOpen" class="rk-scrim" @click.self="closeModal">
    <div class="rk-dialog graph-modal-content" role="dialog" aria-modal="true" aria-labelledby="graph-modal-title">
      <div class="rk-dialog__header">
        <h2 id="graph-modal-title" class="rk-dialog__title"><span class="mdi mdi-graph-outline"></span> Knowledge Graph</h2>
        <button class="rk-icon-btn" aria-label="Close graph" @click="closeModal">
          <span class="mdi mdi-close"></span>
        </button>
      </div>
      <div class="graph-body">
        <div class="graph-view">
    <div v-if="loading" class="graph-state" role="status">
      <span class="rk-spinner rk-spinner--lg"></span>
      <p>Loading graph...</p>
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
      <svg ref="svg" class="graph-svg"></svg>

      <!-- Mobile toggle button -->
      <button
        class="graph-info-toggle"
        :class="{ 'is-open': showGraphInfo }"
        @click="showGraphInfo = !showGraphInfo"
        aria-label="Toggle graph info"
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
        title="Graph Settings"
        aria-label="Toggle graph settings"
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
import { getCached } from '@/api/http'
import { apiUrl } from '@/config/env'
import { getNodeColor, getColorForType } from '../config/nodeColors'
import { drawStarfield, getLinkEndpointId, computeDegrees, createDragHandlers } from '@/composables/useConstellationGraph'

export default {
  name: 'GraphModal',
  props: {
    isOpen: {
      type: Boolean,
      required: true
    }
  },
  emits: ['close'],
  data() {
    return {
      nodes: [],
      links: [],
      loading: true,
      error: null,
      simulation: null,
      svg: null,
      g: null,
      zoom: null,
      showTypeStats: false,
      showGraphInfo: false,
      highlightedType: null,
      linkSelection: null,
      nodeSelection: null,
      zoomTimeout: null,
      showForceSettings: false,
      forceSettings: {
        linkDistance: 60,
        chargeStrength: -400
      }
    }
  },
  computed: {
    typeStatistics() {
      const stats = {}
      this.nodes.forEach(node => {
        const type = node.type || null
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
        if (this.simulation) {
          this.simulation.stop()
        }
      }
    }
  },
  mounted() {
    if (this.isOpen) {
      this.fetchGraphData()
    }
  },
  beforeUnmount() {
    if (this.simulation) {
      this.simulation.stop()
    }
    if (this.zoomTimeout) {
      clearTimeout(this.zoomTimeout)
    }
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

        this.nodes = data.nodes.map(node => ({ ...node }))
        this.links = data.links.map(link => ({ ...link }))
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
      const container = this.$refs.svg
      if (!container) return
      
      d3.select(container).selectAll('*').remove()
      
      const width = container.clientWidth
      const height = container.clientHeight
      
      this.svg = d3.select(container)
        .attr('width', width)
        .attr('height', height)

      // ── Starfield on canvas (drawn once, zero repaint cost) ───────────
      drawStarfield(this.$refs.starCanvas, width, height, {
        density: 6000,
        sizeRanges: [[0.3, 0.8], [0.8, 1.5], [1.5, 2.4]],
        opacityRange: [0.15, 0.55]
      })


      const debouncedZoom = (event) => {
        this.g.attr('transform', event.transform)
      }
      
      this.zoom = d3.zoom()
        .scaleExtent([0.05, 10])
        .on('zoom', (event) => {
          clearTimeout(this.zoomTimeout)
          this.zoomTimeout = setTimeout(() => debouncedZoom(event), 8)
        })
      
      this.svg.call(this.zoom)
      
      this.g = this.svg.append('g')
      
      // ── Degree calculation ─────────────────────────────────────────────
      const { degrees, maxDegree } = computeDegrees(this.nodes, this.links)

      this.nodes.forEach(node => {
        node.degree = degrees[node.id] || 0
        // Star constellation: smaller, more subtle sizes. Hubs slightly bigger.
        node.radius = 2.5 + Math.sqrt(node.degree) * 1.8
        node.isHub = node.degree >= maxDegree * 0.4
        node.size = node.radius
      })
      
      this.simulation = d3.forceSimulation(this.nodes)
        .force('link', d3.forceLink(this.links)
          .id(d => d.id)
          .distance(this.forceSettings.linkDistance)
          .strength(0.08))
        .force('charge', d3.forceManyBody().strength(this.forceSettings.chargeStrength))
        .force('center', d3.forceCenter(width / 2, height / 2))
        .force('collision', d3.forceCollide().radius(d => (d.radius || 4) + 8))
        .alphaDecay(0.02)
        .velocityDecay(0.4)
      
      // ── Constellation lines ────────────────────────────────────────────
      const link = this.g.append('g')
        .selectAll('line')
        .data(this.links)
        .enter()
        .append('line')
        .attr('class', 'graph-link')
        .attr('stroke', 'rgba(160, 190, 255, 0.3)')
        .attr('stroke-opacity', 1)
        .attr('stroke-width', 0.8)
      
      this.linkSelection = link

      // ── Star nodes ────────────────────────────────────────────────────
      const { dragStarted, dragged, dragEnded } = createDragHandlers(() => this.simulation)

      const node = this.g.append('g')
        .selectAll('g')
        .data(this.nodes)
        .enter()
        .append('g')
        .attr('class', 'graph-node')
        .call(d3.drag()
          .on('start', dragStarted)
          .on('drag', dragged)
          .on('end', dragEnded))
      
      this.nodeSelection = node
      
      const self = this

      // Glow rings: 3 cheap concentric circles simulate bloom without any SVG filter
      node.append('circle')
        .attr('class', 'star-glow3')
        .attr('r', d => d.radius * (d.isHub ? 6 : 5))
        .attr('fill', d => this.getNodeColor(d))
        .attr('opacity', d => d.isHub ? 0.06 : 0.04)
        .style('pointer-events', 'none')

      node.append('circle')
        .attr('class', 'star-halo')
        .attr('r', d => d.radius * (d.isHub ? 3.5 : 2.8))
        .attr('fill', d => this.getNodeColor(d))
        .attr('opacity', d => d.isHub ? 0.13 : 0.08)
        .style('pointer-events', 'none')

      // Core star circle (no filter — zero GPU blur cost)
      node.append('circle')
        .attr('class', 'star-core')
        .attr('r', d => d.radius)
        .attr('fill', d => this.getNodeColor(d))
        .on('click', (event, d) => this.onNodeClick(d))
        .on('mouseover', function(event, d) {
          if (self.highlightedType !== null) return
          d3.select(this).attr('r', d.radius * 1.8)
          d3.select(this.parentNode).select('.star-halo').attr('opacity', 0.28)
          d3.select(this.parentNode).select('text').attr('opacity', 1)
          self.highlightConnectedLinks(d, true)
        })
        .on('mouseout', function(event, d) {
          if (self.highlightedType !== null) return
          d3.select(this).attr('r', d.radius)
          d3.select(this.parentNode).select('.star-halo').attr('opacity', d.isHub ? 0.13 : 0.08)
          d3.select(this.parentNode).select('text').attr('opacity', d.degree > 2 ? 0.45 : 0.15)
          self.highlightConnectedLinks(d, false)
        })

      // 4-point diffraction spike for hub stars
      node.filter(d => d.isHub).append('line')
        .attr('class', 'star-spike-h')
        .attr('x1', d => -d.radius * 3).attr('y1', 0)
        .attr('x2', d => d.radius * 3).attr('y2', 0)
        .attr('stroke', d => this.getNodeColor(d))
        .attr('stroke-width', 0.8)
        .attr('opacity', 0.5)
        .style('pointer-events', 'none')

      node.filter(d => d.isHub).append('line')
        .attr('class', 'star-spike-v')
        .attr('x1', 0).attr('y1', d => -d.radius * 3)
        .attr('x2', 0).attr('y2', d => d.radius * 3)
        .attr('stroke', d => this.getNodeColor(d))
        .attr('stroke-width', 0.8)
        .attr('opacity', 0.5)
        .style('pointer-events', 'none')
      
      node.append('text')
        .text(d => d.title)
        .attr('x', d => d.radius + 6)
        .attr('y', 4)
        .attr('font-size', d => d.isHub ? '12px' : '10px')
        .attr('fill', 'rgba(200, 220, 255, 0.9)')
        .attr('font-weight', d => d.isHub ? '600' : '400')
        .attr('opacity', d => d.degree > 2 ? 0.45 : 0.15)
        .attr('letter-spacing', '0.03em')
        .style('pointer-events', 'none')
        .style('user-select', 'none')
      
      this.simulation.on('tick', () => {
        link
          .attr('x1', d => d.source.x)
          .attr('y1', d => d.source.y)
          .attr('x2', d => d.target.x)
          .attr('y2', d => d.target.y)
        
        node.attr('transform', d => `translate(${d.x},${d.y})`)
      })
    },

    getNodeColor(node) {
      return getNodeColor(node)
    },
    
    getColorForTypeName(typeName) {
      return getColorForType(typeName)
    },
    
    onNodeClick(node) {
      this.closeModal()
      this.$router.push(`/note/${encodeURIComponent(node.id)}`)
    },
    
    closeModal() {
      this.$emit('close')
    },

    highlightConnectedLinks(hoveredNode, highlight) {
      if (!this.linkSelection || !this.nodeSelection) return

      const connectedNodeIds = new Set()
      connectedNodeIds.add(hoveredNode.id)

      this.links.forEach(link => {
        const sourceId = getLinkEndpointId(link.source)
        const targetId = getLinkEndpointId(link.target)

        if (sourceId === hoveredNode.id) {
          connectedNodeIds.add(targetId)
        } else if (targetId === hoveredNode.id) {
          connectedNodeIds.add(sourceId)
        }
      })
      
      if (highlight) {
        this.linkSelection.each(function(d) {
          const linkEl = d3.select(this)
          const sourceId = getLinkEndpointId(d.source)
          const targetId = getLinkEndpointId(d.target)
          const isConnected = sourceId === hoveredNode.id || targetId === hoveredNode.id
          linkEl
            .attr('stroke', isConnected ? 'rgba(200, 225, 255, 0.85)' : 'rgba(100, 130, 200, 0.08)')
            .attr('stroke-width', isConnected ? 1.2 : 0.5)
        })
        this.nodeSelection.each(function(d) {
          const nodeEl = d3.select(this)
          const isConnected = connectedNodeIds.has(d.id)
          nodeEl.select('.star-core').attr('opacity', isConnected ? 1 : 0.15)
          nodeEl.select('.star-halo').attr('opacity', isConnected ? (d.isHub ? 0.13 : 0.08) : 0.01)
          nodeEl.select('.star-glow3').attr('opacity', isConnected ? (d.isHub ? 0.06 : 0.04) : 0.01)
          nodeEl.select('text').attr('opacity', isConnected ? 1 : 0.03)
        })
      } else {
        this.linkSelection
          .attr('stroke', 'rgba(160, 190, 255, 0.3)')
          .attr('stroke-width', 0.8)
        this.nodeSelection.each(function(d) {
          const nodeEl = d3.select(this)
          nodeEl.select('.star-core').attr('opacity', 1)
          nodeEl.select('.star-halo').attr('opacity', d.isHub ? 0.13 : 0.08)
          nodeEl.select('.star-glow3').attr('opacity', d.isHub ? 0.06 : 0.04)
          nodeEl.select('text').attr('opacity', d.degree > 2 ? 0.45 : 0.15)
        })
      }
    },
    
    toggleTypeHighlight(type) {
      if (this.highlightedType === type) {
        this.highlightedType = null
      } else {
        this.highlightedType = type
      }
      this.updateNodeHighlighting()
    },
    
    updateNodeHighlighting() {
      if (!this.g) return
      
      const highlightedType = this.highlightedType
      
      this.g.selectAll('.graph-node').each(function(d) {
        const node = d3.select(this)
        const core = node.select('.star-core')
        const halo = node.select('.star-halo')
        const glow3 = node.select('.star-glow3')
        const text = node.select('text')
        if (highlightedType === null) {
          core.attr('opacity', 1).attr('r', d.radius)
          halo.attr('opacity', d.isHub ? 0.13 : 0.08)
          glow3.attr('opacity', d.isHub ? 0.06 : 0.04)
          text.attr('opacity', d.degree > 2 ? 0.45 : 0.15)
        } else {
          const nodeType = d.type || null
          const isMatch = nodeType === highlightedType
          core.attr('opacity', isMatch ? 1 : 0.1).attr('r', isMatch ? d.radius * 1.4 : d.radius * 0.6)
          halo.attr('opacity', isMatch ? (d.isHub ? 0.2 : 0.15) : 0.01)
          glow3.attr('opacity', isMatch ? (d.isHub ? 0.08 : 0.05) : 0.01)
          text.attr('opacity', isMatch ? 1 : 0.03)
        }
      })
      this.g.selectAll('.graph-link').each(function(d) {
        const link = d3.select(this)
        if (highlightedType === null) {
          link.attr('stroke', 'rgba(160, 190, 255, 0.3)').attr('stroke-width', 0.8)
        } else {
          const sourceType = d.source.type || null
          const targetType = d.target.type || null
          const isConnected = sourceType === highlightedType || targetType === highlightedType
          link
            .attr('stroke', isConnected ? 'rgba(180, 210, 255, 0.7)' : 'rgba(100, 130, 200, 0.04)')
            .attr('stroke-width', isConnected ? 1.1 : 0.4)
        }
      })
    },
    
    updateChargeStrength(value) {
      this.forceSettings.chargeStrength = -Number(value)
      this.updateForces()
    },
    
    updateForces() {
      if (!this.simulation) return
      
      this.simulation.force('link').distance(this.forceSettings.linkDistance)
      this.simulation.force('charge').strength(this.forceSettings.chargeStrength)
      this.simulation.force('collision').radius(d => (d.radius || d.size || 4) + 8)
      
      this.simulation.alpha(0.3).restart()
    }
  }
}
</script>

<style scoped>
/* Shell comes from .rk-scrim / .rk-dialog; only the canvas size lives here. */
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

.graph-svg {
  width: 100%;
  height: 100%;
  cursor: grab;
}

.graph-svg:active {
  cursor: grabbing;
}

/* No CSS animations — all transitions handled by D3 for perf */
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

.graph-node {
  cursor: pointer;
}

.graph-node text {
  fill: rgba(200, 220, 255, 0.9);
  font-weight: 400;
  font-family: var(--font-body);
  letter-spacing: 0.04em;
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
