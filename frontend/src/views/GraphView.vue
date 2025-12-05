<template>
  <div class="graph-view">
    <div v-if="loading" class="loading">
      <p>Cargando grafo...</p>
    </div>
    
    <div v-else-if="error" class="error">
      <p>{{ error }}</p>
    </div>
    
    <div v-else class="graph-container">
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
        <p>{{ nodes.length }} notas | {{ links.length }} conexiones</p>
        <button @click="showTypeStats = !showTypeStats" class="stats-toggle">
          {{ showTypeStats ? '▼' : '▶' }} Tipos
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
            <span class="type-name">{{ type || 'sin tipo' }}</span>
            <span class="type-count">{{ count }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import axios from 'axios'
import * as d3 from 'd3'
import { getNodeColor, getColorForType } from '../config/nodeColors'

export default {
  name: 'GraphView',
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
      nodeSelection: null
    }
  },
  computed: {
    apiUrl() {
      return import.meta.env.VITE_API_URL || 'http://localhost:8000'
    },
    typeStatistics() {
      const stats = {}
      this.nodes.forEach(node => {
        const type = node.type || null
        stats[type] = (stats[type] || 0) + 1
      })
      // Sort by count descending
      return Object.fromEntries(
        Object.entries(stats).sort((a, b) => b[1] - a[1])
      )
    }
  },
  mounted() {
    this.fetchGraphData()
  },
  beforeUnmount() {
    if (this.simulation) {
      this.simulation.stop()
    }
  },
  methods: {
    async fetchGraphData() {
      this.loading = true
      this.error = null
      
      try {
        const response = await axios.get(`${this.apiUrl}/api/graph/all`)
        this.nodes = response.data.nodes.map(node => ({ ...node }))
        this.links = response.data.links.map(link => ({ ...link }))
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
      
      // Clear previous graph
      d3.select(container).selectAll('*').remove()
      
      const width = container.clientWidth
      const height = container.clientHeight
      
      // Setup SVG
      this.svg = d3.select(container)
        .attr('width', width)
        .attr('height', height)
      
      // Add zoom behavior
      this.zoom = d3.zoom()
        .scaleExtent([0.1, 10])
        .on('zoom', (event) => {
          this.g.attr('transform', event.transform)
        })
      
      this.svg.call(this.zoom)
      
      // Main group for zooming
      this.g = this.svg.append('g')
      
      // Create simulation
      this.simulation = d3.forceSimulation(this.nodes)
        .force('link', d3.forceLink(this.links)
          .id(d => d.id)
          .distance(150)
          .strength(0.3))
        .force('charge', d3.forceManyBody().strength(-200))
        .force('center', d3.forceCenter(width / 2, height / 2))
        .force('collision', d3.forceCollide().radius(30))
      
      // Draw links
      const link = this.g.append('g')
        .selectAll('line')
        .data(this.links)
        .enter()
        .append('line')
        .attr('class', 'graph-link')
        .attr('stroke', 'var(--graph-link)')
        .attr('stroke-opacity', 'var(--graph-linkOpacity)')
        .attr('stroke-width', 1.5)
      
      // Store link selection for hover highlighting
      this.linkSelection = link
      
      // Draw nodes
      const node = this.g.append('g')
        .selectAll('g')
        .data(this.nodes)
        .enter()
        .append('g')
        .attr('class', 'graph-node')
        .call(d3.drag()
          .on('start', (event, d) => this.dragStarted(event, d))
          .on('drag', (event, d) => this.dragged(event, d))
          .on('end', (event, d) => this.dragEnded(event, d)))
      
      // Store node selection for hover highlighting
      this.nodeSelection = node
      
      // Reference to component for event handlers
      const self = this
      
      // Node circles
      node.append('circle')
        .attr('r', 7)
        .attr('fill', d => this.getNodeColor(d))
        .attr('stroke', 'var(--bg-primary)')
        .attr('stroke-width', 2)
        .on('click', (event, d) => this.onNodeClick(d))
        .on('mouseover', function(event, d) {
          // Don't highlight on hover if type filter is active
          if (self.highlightedType !== null) return
          
          // Enlarge hovered node
          d3.select(this)
            .attr('r', 10)
            .attr('stroke-width', 3)
          
          // Highlight connected links
          self.highlightConnectedLinks(d, true)
        })
        .on('mouseout', function(event, d) {
          // Don't reset if type filter is active
          if (self.highlightedType !== null) return
          
          // Reset node size
          d3.select(this)
            .attr('r', 7)
            .attr('stroke-width', 2)
          
          // Reset link highlighting
          self.highlightConnectedLinks(d, false)
        })
      
      // Node labels
      node.append('text')
        .text(d => d.title)
        .attr('x', 12)
        .attr('y', 4)
        .attr('font-size', '11px')
        .attr('fill', 'var(--text-primary)')
        .attr('font-weight', '500')
        .style('pointer-events', 'none')
        .style('user-select', 'none')
      
      // Update positions on tick
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
      this.$router.push(`/note/${node.path}`)
    },
    
    dragStarted(event, d) {
      if (!event.active) this.simulation.alphaTarget(0.3).restart()
      d.fx = d.x
      d.fy = d.y
    },
    
    dragged(event, d) {
      d.fx = event.x
      d.fy = event.y
    },
    
    dragEnded(event, d) {
      if (!event.active) this.simulation.alphaTarget(0)
      d.fx = null
      d.fy = null
    },
    
    highlightConnectedLinks(hoveredNode, highlight) {
      if (!this.linkSelection || !this.nodeSelection) return
      
      // Find connected node IDs
      const connectedNodeIds = new Set()
      connectedNodeIds.add(hoveredNode.id)
      
      this.links.forEach(link => {
        const sourceId = typeof link.source === 'object' ? link.source.id : link.source
        const targetId = typeof link.target === 'object' ? link.target.id : link.target
        
        if (sourceId === hoveredNode.id) {
          connectedNodeIds.add(targetId)
        } else if (targetId === hoveredNode.id) {
          connectedNodeIds.add(sourceId)
        }
      })
      
      if (highlight) {
        // Highlight connected links
        this.linkSelection.each(function(d) {
          const linkEl = d3.select(this)
          const sourceId = typeof d.source === 'object' ? d.source.id : d.source
          const targetId = typeof d.target === 'object' ? d.target.id : d.target
          const isConnected = sourceId === hoveredNode.id || targetId === hoveredNode.id
          
          linkEl
            .attr('stroke', isConnected ? 'var(--interactive-primary)' : 'var(--graph-link)')
            .attr('stroke-width', isConnected ? 2.5 : 1)
            .attr('stroke-opacity', isConnected ? 1 : 0.15)
        })
        
        // Dim non-connected nodes
        this.nodeSelection.each(function(d) {
          const nodeEl = d3.select(this)
          const isConnected = connectedNodeIds.has(d.id)
          
          nodeEl.select('circle')
            .attr('opacity', isConnected ? 1 : 0.3)
          nodeEl.select('text')
            .attr('opacity', isConnected ? 1 : 0.3)
        })
      } else {
        // Reset all links
        this.linkSelection
          .attr('stroke', 'var(--graph-link)')
          .attr('stroke-width', 1.5)
          .attr('stroke-opacity', 'var(--graph-linkOpacity)')
        
        // Reset all nodes
        this.nodeSelection.each(function() {
          const nodeEl = d3.select(this)
          nodeEl.select('circle').attr('opacity', 1)
          nodeEl.select('text').attr('opacity', 1)
        })
      }
    },
    
    toggleTypeHighlight(type) {
      // Toggle off if clicking the same type
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
      
      // Update nodes
      this.g.selectAll('.graph-node').each(function(d) {
        const node = d3.select(this)
        const circle = node.select('circle')
        const text = node.select('text')
        
        if (highlightedType === null) {
          // No filter - restore all nodes
          circle
            .attr('opacity', 1)
            .attr('r', 7)
          text.attr('opacity', 1)
        } else {
          // Check if node matches the highlighted type
          const nodeType = d.type || null
          const isMatch = nodeType === highlightedType
          
          circle
            .attr('opacity', isMatch ? 1 : 0.15)
            .attr('r', isMatch ? 9 : 5)
          text.attr('opacity', isMatch ? 1 : 0.15)
        }
      })
      
      // Update links
      this.g.selectAll('.graph-link').each(function(d) {
        const link = d3.select(this)
        
        if (highlightedType === null) {
          link.attr('opacity', 1)
        } else {
          const sourceType = d.source.type || null
          const targetType = d.target.type || null
          const isConnected = sourceType === highlightedType || targetType === highlightedType
          
          link.attr('opacity', isConnected ? 0.6 : 0.05)
        }
      })
    }
  }
}
</script>

<style scoped>
.graph-view {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: transparent;
}

.loading, .error {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1rem;
  color: var(--text-secondary);
}

.error {
  color: var(--status-error);
}

.graph-container {
  flex: 1;
  position: relative;
  overflow: hidden;
  background: transparent;
}

.graph-svg {
  width: 100%;
  height: 100%;
  cursor: grab;
}

.graph-svg:active {
  cursor: grabbing;
}

.graph-info {
  position: absolute;
  bottom: 1.5rem;
  left: 1.5rem;
  background: rgba(12, 13, 29, 0.9);
  backdrop-filter: blur(12px);
  padding: 1rem;
  border-radius: 12px;
  font-size: 0.9rem;
  color: var(--text-secondary);
  box-shadow: 0 4px 16px rgba(75, 0, 130, 0.4);
  min-width: 220px;
  border: 1px solid rgba(138, 92, 245, 0.3);
}

.graph-info p {
  margin: 0 0 0.75rem 0;
  color: var(--text-primary);
  font-weight: 500;
  font-size: 0.95rem;
}

.stats-toggle {
  background: transparent;
  border: none;
  padding: 0.5rem;
  cursor: pointer;
  font-size: 0.85rem;
  color: var(--interactive-primary);
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  text-align: left;
  transition: all 0.2s ease;
  border-radius: 6px;
  font-weight: 500;
}

.stats-toggle:hover {
  background: var(--interactive-secondary);
  color: var(--interactive-primaryHover);
}

.type-stats {
  margin-top: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--border-light);
  max-height: 300px;
  overflow-y: auto;
}

.type-stats::-webkit-scrollbar {
  width: 6px;
}

.type-stats::-webkit-scrollbar-track {
  background: transparent;
}

.type-stats::-webkit-scrollbar-thumb {
  background: var(--border-medium);
  border-radius: 3px;
}

.type-stat-item {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  padding: 0.375rem 0.5rem;
  font-size: 0.85rem;
  border-radius: 6px;
  transition: all 0.15s ease;
  cursor: pointer;
  border: 1px solid transparent;
}

.type-stat-item:hover {
  background: var(--interactive-secondary);
}

.type-stat-item.is-selected {
  background: rgba(138, 92, 245, 0.25);
  border-color: rgba(138, 92, 245, 0.5);
}

.type-color {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 1px solid var(--border-medium);
  flex-shrink: 0;
}

.type-name {
  flex: 1;
  color: var(--text-primary);
  font-style: italic;
  font-size: 0.85rem;
}

.type-count {
  color: var(--text-secondary);
  font-weight: 600;
  min-width: 32px;
  text-align: right;
  font-size: 0.85rem;
}

.graph-node {
  cursor: pointer;
}

.graph-node circle {
  transition: all 0.2s ease;
}

.graph-node text {
  fill: var(--text-primary);
  font-weight: 500;
}

/* Mobile toggle button for graph info */
.graph-info-toggle {
  display: none;
  position: fixed;
  bottom: calc(70px + 1rem + env(safe-area-inset-bottom, 0px));
  left: 1.5rem;
  z-index: 101;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: linear-gradient(135deg, #8a5cf5 0%, #6366f1 100%);
  border: none;
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(138, 92, 245, 0.4);
  transition: all 0.3s ease;
  align-items: center;
  justify-content: center;
}

.graph-info-toggle .mdi {
  font-size: 1.5rem;
  color: white;
}

.graph-info-toggle:hover {
  transform: scale(1.05);
  box-shadow: 0 6px 20px rgba(138, 92, 245, 0.5);
}

.graph-info-toggle.is-open {
  background: rgba(31, 32, 69, 0.95);
}

/* Mobile responsive styles */
@media (max-width: 768px) {
  .graph-info-toggle {
    display: flex;
  }

  .graph-info {
    position: fixed;
    bottom: calc(70px + 5rem + env(safe-area-inset-bottom, 0px));
    left: 1.5rem;
    right: auto;
    max-width: calc(100vw - 3rem);
    min-width: 200px;
    transform: scale(0);
    transform-origin: bottom left;
    opacity: 0;
    pointer-events: none;
    transition: all 0.3s ease;
  }

  .graph-info.is-open {
    transform: scale(1);
    opacity: 1;
    pointer-events: auto;
  }

  .type-stats {
    max-height: 200px;
  }
}
</style>
