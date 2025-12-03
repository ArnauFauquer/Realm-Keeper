<template>
  <div class="note-graph">
    <div v-if="loading" class="loading">
      <p>Cargando...</p>
    </div>
    
    <div v-else-if="error" class="error">
      <p>{{ error }}</p>
    </div>
    
    <div v-else class="graph-container">
      <button @click="expand" class="expand-btn" title="Ver grafo completo">
        <span class="mdi mdi-arrow-expand-all"></span>
      </button>
      <svg ref="svg" class="graph-svg"></svg>
    </div>
  </div>
</template>

<script>
import axios from 'axios'
import * as d3 from 'd3'
import { getNodeColor, GRAPH_COLORS } from '../config/nodeColors'

export default {
  name: 'NoteGraph',
  props: {
    notePath: {
      type: String,
      required: true
    }
  },
  data() {
    return {
      nodes: [],
      links: [],
      loading: true,
      error: null,
      simulation: null
    }
  },
  computed: {
    apiUrl() {
      return import.meta.env.VITE_API_URL || 'http://localhost:8000'
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
  watch: {
    notePath() {
      this.fetchGraphData()
    }
  },
  methods: {
    async fetchGraphData() {
      this.loading = true
      this.error = null
      
      try {
        const response = await axios.get(`${this.apiUrl}/api/graph/note/${this.notePath}`)
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
      const centerX = width / 2
      const centerY = height / 2
      
      // Setup SVG
      const svg = d3.select(container)
        .attr('width', width)
        .attr('height', height)

      const g = svg.append('g')
      
      // Add zoom/pan behavior
      const zoom = d3.zoom()
        .scaleExtent([0.3, 4])
        .on('zoom', (event) => {
          g.attr('transform', event.transform)
        })
      
      svg.call(zoom)
      
      // Find the central node id first
      const centralNodeId = this.nodes.find(n => n.central)?.id
      if (!centralNodeId) return
      
      // Deduplicate nodes by id
      const uniqueNodesMap = new Map()
      this.nodes.forEach(node => {
        if (!uniqueNodesMap.has(node.id)) {
          uniqueNodesMap.set(node.id, { ...node })
        }
      })
      const uniqueNodes = [...uniqueNodesMap.values()]
      
      // Get the central node from unique nodes
      const centralNode = uniqueNodesMap.get(centralNodeId)
      if (!centralNode) return
      
      // Deduplicate links by source-target pair
      const uniqueLinksSet = new Set()
      const uniqueLinks = this.links.filter(link => {
        const sourceId = typeof link.source === 'object' ? link.source.id : link.source
        const targetId = typeof link.target === 'object' ? link.target.id : link.target
        const key = `${sourceId}|${targetId}`
        if (uniqueLinksSet.has(key)) return false
        uniqueLinksSet.add(key)
        return true
      })
      
      // Categorize nodes by their relationship to the central node
      const incomingNodeIds = new Set()
      const outgoingNodeIds = new Set()
      
      // Only consider links that connect to the central node
      const relevantLinks = uniqueLinks.filter(link => {
        const sourceId = typeof link.source === 'object' ? link.source.id : link.source
        const targetId = typeof link.target === 'object' ? link.target.id : link.target
        
        if (targetId === centralNode.id) {
          incomingNodeIds.add(sourceId)
          return true
        } else if (sourceId === centralNode.id) {
          outgoingNodeIds.add(targetId)
          return true
        }
        return false
      })
      
      // Handle bidirectional nodes - they appear as ONLY incoming (left side)
      // Bidirectional nodes have links both ways with the central node
      const bidirectionalNodeIds = new Set(
        [...incomingNodeIds].filter(id => outgoingNodeIds.has(id))
      )
      
      // Remove bidirectional nodes from outgoing (they'll only appear on left)
      bidirectionalNodeIds.forEach(id => outgoingNodeIds.delete(id))
      
      // Filter out duplicate links for bidirectional nodes (keep only incoming)
      const filteredLinks = relevantLinks.filter(link => {
        const sourceId = typeof link.source === 'object' ? link.source.id : link.source
        const targetId = typeof link.target === 'object' ? link.target.id : link.target
        
        // If this is an outgoing link from central to a bidirectional node, skip it
        if (sourceId === centralNode.id && bidirectionalNodeIds.has(targetId)) {
          return false
        }
        return true
      })
      
      // Get unique incoming and outgoing nodes (use uniqueNodes)
      const incomingNodes = uniqueNodes.filter(n => incomingNodeIds.has(n.id) && !n.central)
      const outgoingNodes = uniqueNodes.filter(n => outgoingNodeIds.has(n.id) && !n.central)
      
      // All nodes to display (central + incoming + outgoing, no duplicates)
      const displayedNodeIds = new Set([centralNode.id, ...incomingNodeIds, ...outgoingNodeIds])
      const displayedNodes = uniqueNodes.filter(n => displayedNodeIds.has(n.id))
      
      // Position nodes in a horizontal layout
      const leftX = centerX - 180
      const rightX = centerX + 180
      const nodeSpacing = 35
      
      // Position central node
      centralNode.x = centerX
      centralNode.y = centerY
      centralNode.fx = centerX
      centralNode.fy = centerY
      
      // Position incoming nodes on the left
      const incomingStartY = centerY - ((incomingNodes.length - 1) * nodeSpacing) / 2
      incomingNodes.forEach((node, i) => {
        node.x = leftX
        node.y = incomingStartY + i * nodeSpacing
        node.fx = leftX
        node.fy = incomingStartY + i * nodeSpacing
      })
      
      // Position outgoing nodes on the right
      const outgoingStartY = centerY - ((outgoingNodes.length - 1) * nodeSpacing) / 2
      outgoingNodes.forEach((node, i) => {
        node.x = rightX
        node.y = outgoingStartY + i * nodeSpacing
        node.fx = rightX
        node.fy = outgoingStartY + i * nodeSpacing
      })
      
      // Determine if a link is incoming or outgoing
      const isIncomingLink = (link) => {
        const targetId = typeof link.target === 'object' ? link.target.id : link.target
        return targetId === centralNode.id
      }
      
      // Draw curved links (no arrows)
      const link = g.append('g')
        .selectAll('path')
        .data(filteredLinks)
        .enter()
        .append('path')
        .attr('class', 'graph-link')
        .attr('fill', 'none')
        .attr('stroke', d => isIncomingLink(d) ? GRAPH_COLORS.incomingLink : GRAPH_COLORS.outgoingLink)
        .attr('stroke-opacity', 0.8)
        .attr('stroke-width', 2.5)
      
      // Draw nodes (only displayed ones)
      const node = g.append('g')
        .selectAll('g')
        .data(displayedNodes)
        .enter()
        .append('g')
        .attr('class', 'graph-node')
        .call(d3.drag()
          .on('start', (event, d) => this.dragStarted(event, d))
          .on('drag', (event, d) => this.dragged(event, d))
          .on('end', (event, d) => this.dragEnded(event, d)))
      
      // Node circles
      node.append('circle')
        .attr('r', d => d.central ? 28 : 10)
        .attr('fill', d => {
          if (d.central) return GRAPH_COLORS.centralNode
          // Bidirectional nodes are cyan (on left side with incoming)
          if (bidirectionalNodeIds.has(d.id)) return GRAPH_COLORS.bidirectionalNode
          if (incomingNodeIds.has(d.id)) return GRAPH_COLORS.incomingNode
          if (outgoingNodeIds.has(d.id)) return GRAPH_COLORS.outgoingNode
          return this.getNodeColor(d)
        })
        .attr('stroke', d => {
          if (d.central) return GRAPH_COLORS.centralNodeStroke
          // Bidirectional nodes get purple stroke to indicate they also have outgoing links
          if (bidirectionalNodeIds.has(d.id)) return GRAPH_COLORS.bidirectionalNodeStroke
          return GRAPH_COLORS.defaultNodeStroke
        })
        .attr('stroke-width', d => d.central ? 4 : (bidirectionalNodeIds.has(d.id) ? 3 : 2))
        .on('click', (event, d) => {
          if (!d.central) {
            this.onNodeClick(d)
          }
        })
        .style('cursor', d => d.central ? 'default' : 'pointer')
        .on('mouseover', function(event, d) {
          if (!d.central) {
            d3.select(this).attr('r', 13)
          }
        })
        .on('mouseout', function(event, d) {
          if (!d.central) {
            d3.select(this).attr('r', 10)
          }
        })
      
      // Node labels - position based on node location
      node.append('text')
        .text(d => d.title.length > 18 ? d.title.substring(0, 15) + '...' : d.title)
        .attr('x', d => {
          if (d.central) return 0
          if (incomingNodeIds.has(d.id)) return -15
          return 15
        })
        .attr('y', d => d.central ? 0 : 4)
        .attr('text-anchor', d => {
          if (d.central) return 'middle'
          if (incomingNodeIds.has(d.id)) return 'end'
          return 'start'
        })
        .attr('dominant-baseline', d => d.central ? 'middle' : 'auto')
        .attr('font-size', d => d.central ? '13px' : '11px')
        .attr('font-weight', d => d.central ? 'bold' : 'normal')
        .attr('fill', d => d.central ? GRAPH_COLORS.centralNodeText : 'var(--text-primary)')
        .style('pointer-events', 'none')
      
      // Function to create curved path - always draw from left to right
      const createPath = (d) => {
        const sourceNode = displayedNodes.find(n => n.id === (typeof d.source === 'object' ? d.source.id : d.source))
        const targetNode = displayedNodes.find(n => n.id === (typeof d.target === 'object' ? d.target.id : d.target))
        
        if (!sourceNode || !targetNode) return ''
        
        const sourceX = sourceNode.fx || sourceNode.x
        const sourceY = sourceNode.fy || sourceNode.y
        const targetX = targetNode.fx || targetNode.x
        const targetY = targetNode.fy || targetNode.y
        
        // Determine which node is on the left and which is on the right
        let leftX, leftY, rightX, rightY
        if (sourceX < targetX) {
          leftX = sourceX; leftY = sourceY
          rightX = targetX; rightY = targetY
        } else {
          leftX = targetX; leftY = targetY
          rightX = sourceX; rightY = sourceY
        }
        
        // Create a curved path from left to right
        const midX = (leftX + rightX) / 2
        
        return `M ${leftX},${leftY} Q ${midX},${leftY} ${midX},${(leftY + rightY) / 2} T ${rightX},${rightY}`
      }
      
      // Set initial positions
      link.attr('d', d => createPath(d))
      node.attr('transform', d => `translate(${d.fx || d.x},${d.fy || d.y})`)
      
      // Create minimal simulation just for smooth updates
      this.simulation = d3.forceSimulation(displayedNodes)
        .alpha(0)
        .on('tick', () => {
          link.attr('d', d => createPath(d))
          node.attr('transform', d => `translate(${d.fx || d.x},${d.fy || d.y})`)
        })
    },
    
    getNodeColor(node) {
      return getNodeColor(node)
    },
    
    onNodeClick(node) {
      this.$router.push(`/note/${node.path}`)
    },
    
    expand() {
      this.$router.push('/graph')
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
      // Keep positions fixed after drag
    }
  }
}
</script>

<style scoped>
.note-graph {
  background: rgba(12, 13, 29, 0.6);
  backdrop-filter: blur(10px);
  border-radius: 12px;
  padding: 1rem;
  box-shadow: 0 4px 20px rgba(75, 0, 130, 0.3);
  margin-top: 1.5rem;
  border: 1px solid rgba(138, 92, 245, 0.3);
  transition: box-shadow 0.3s ease;
}

.note-graph:hover {
  box-shadow: 0 4px 24px rgba(75, 0, 130, 0.4);
}

.expand-btn {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  background: rgba(12, 13, 29, 0.8);
  border: 1px solid rgba(138, 92, 245, 0.3);
  border-radius: 6px;
  padding: 0.5rem;
  cursor: pointer;
  color: var(--text-primary);
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  z-index: 10;
  opacity: 0.8;
}

.expand-btn:hover {
  opacity: 1;
  background: rgba(138, 92, 245, 0.2);
  border-color: var(--interactive-primary);
  box-shadow: 0 0 10px rgba(138, 92, 245, 0.3);
}

.expand-btn .mdi {
  font-size: 1.1rem;
}

.loading, .error {
  padding: 1.5rem;
  text-align: center;
  color: var(--text-secondary);
  font-size: 0.9rem;
}

.error {
  color: var(--status-error);
}

.graph-container {
  height: 280px;
  position: relative;
  border: 1px solid rgba(138, 92, 245, 0.2);
  border-radius: 8px;
  overflow: hidden;
  background: rgba(12, 13, 29, 0.4);
}

.graph-svg {
  width: 100%;
  height: 100%;
  cursor: grab;
}

.graph-svg:active {
  cursor: grabbing;
}

.graph-node {
  cursor: pointer;
}
</style>
