<template>
  <aside class="right-sidebar">
    <div class="sidebar-section mini-graph-section">
      <h3>Interactive Graph</h3>
      <div class="mini-graph-container" ref="graphContainer">
        <div v-if="loading" class="loading">Loading...</div>
        <div v-else-if="error" class="error">{{ error }}</div>
        <template v-else>
          <canvas ref="starCanvas" class="star-canvas"></canvas>
          <svg ref="svg" class="graph-svg"></svg>
        </template>
      </div>
    </div>
    
    <div class="sidebar-section toc-section">
      <h3>On this page</h3>
      <nav class="toc-nav">
        <ul v-if="headers.length">
          <li v-for="header in headers" :key="header.id" :class="`toc-level-${header.level}`">
            <a :href="`#${header.id}`" @click.prevent="scrollTo(header.id)">{{ header.text }}</a>
          </li>
        </ul>
        <p v-else class="no-headers">No headings found.</p>
      </nav>
    </div>
  </aside>
</template>

<script>
import * as d3 from 'd3'
import { getCached } from '@/api/http'
import { getNodeColor } from '../config/nodeColors'

export default {
  name: 'RightSidebar',
  props: {
    note: {
      type: Object,
      required: true
    }
  },
  data() {
    return {
      nodes: [],
      links: [],
      loading: false,
      error: null,
      simulation: null,
      svg: null,
      g: null,
      zoom: null
    }
  },
  computed: {
    apiUrl() {
      return import.meta.env.VITE_API_URL || ''
    },
    headers() {
      if (!this.note || !this.note.content) return []
      
      const lines = this.note.content.split('\n')
      const headers = []
      let headerCount = {}
      let inCodeBlock = false
      
      lines.forEach(line => {
        // Simple code block detection to ignore headers inside code blocks
        if (line.trim().startsWith('```')) {
          inCodeBlock = !inCodeBlock
          return
        }
        
        if (inCodeBlock) return
        
        const match = line.match(/^(#{1,6})\s+(.*)/)
        if (match) {
          const level = match[1].length
          const text = match[2].trim()
          
          // Mimic markdown-it/NoteView logic for ID generation
          const cleanContent = text.replace(/<[^>]+>/g, '')
          const idBase = cleanContent.toLowerCase().replace(/[^\w\s-]/g, '').replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '') || 'header'
          headerCount[idBase] = (headerCount[idBase] || 0) + 1
          const id = headerCount[idBase] > 1 ? `${idBase}-${headerCount[idBase] - 1}` : idBase
          
          headers.push({ level, text, id })
        }
      })
      
      return headers
    }
  },
  watch: {
    'note.id': {
      immediate: true,
      handler(newId) {
        if (newId) {
          this.fetchGraphData()
        }
      }
    }
  },
  beforeUnmount() {
    if (this.simulation) {
      this.simulation.stop()
    }
  },
  methods: {
    scrollTo(id) {
      const element = document.getElementById(id)
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'start' })
        // Update URL hash without jumping
        history.pushState(null, null, `#${id}`)
      }
    },
    async fetchGraphData() {
      this.loading = true
      this.error = null
      
      try {
        const data = await getCached(`${this.apiUrl}/api/graph/all`, {
          useCache: true,
          cacheTtl: 600 // 10 minutos
        })

        if (!data || !data.nodes || !data.links) {
          throw new Error("Invalid graph data format returned from API")
        }
        
        const currentId = this.note.id
        
        // Find nodes connected to current node
        const connectedIds = new Set()
        connectedIds.add(currentId)
        
        const relevantLinks = []
        
        data.links.forEach(link => {
          const sourceId = typeof link.source === 'object' ? link.source.id : link.source
          const targetId = typeof link.target === 'object' ? link.target.id : link.target
          
          if (sourceId === currentId || targetId === currentId) {
            connectedIds.add(sourceId)
            connectedIds.add(targetId)
            relevantLinks.push({ ...link })
          }
        })
        
        // Calculate global connection count (degree) for each node
        const globalDegrees = {}
        data.nodes.forEach(n => {
          globalDegrees[n.id] = 0
        })
        data.links.forEach(link => {
          const sourceId = typeof link.source === 'object' ? link.source.id : link.source
          const targetId = typeof link.target === 'object' ? link.target.id : link.target
          if (globalDegrees[sourceId] !== undefined) globalDegrees[sourceId]++
          if (globalDegrees[targetId] !== undefined) globalDegrees[targetId]++
        })

        this.nodes = data.nodes.filter(n => connectedIds.has(n.id)).map(n => {
          const degree = globalDegrees[n.id] || 0
          const isCurrent = n.id === currentId
          const radius = (isCurrent ? 6 : 4) + Math.sqrt(degree) * 1.5
          return {
            ...n,
            degree,
            radius,
            size: radius
          }
        })
        this.links = relevantLinks
        
        this.loading = false
        
        this.$nextTick(() => {
          this.initGraph()
        })
      } catch (err) {
        this.error = "Could not load graph"
        this.loading = false
      }
    },
    initGraph() {
      const container = this.$refs.svg
      if (!container) return

      d3.select(container).selectAll('*').remove()

      const width = container.clientWidth || 300
      const height = container.clientHeight || 250

      // ── Canvas starfield (drawn once, zero repaint) ──────────────────
      const canvas = this.$refs.starCanvas
      if (canvas) {
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        const rand = (a, b) => a + Math.random() * (b - a)
        const starCount = Math.floor((width * height) / 2000)
        for (let i = 0; i < starCount; i++) {
          const r = Math.random()
          const size = r < 0.7 ? rand(0.2, 0.6) : r < 0.9 ? rand(0.6, 1.1) : rand(1.1, 1.8)
          const opacity = rand(0.12, 0.5)
          const hue = rand(210, 260)
          ctx.beginPath()
          ctx.arc(rand(0, width), rand(0, height), size, 0, Math.PI * 2)
          ctx.fillStyle = `hsla(${hue}, 60%, 90%, ${opacity})`
          ctx.fill()
        }
      }

      this.svg = d3.select(container)
        .attr('width', '100%')
        .attr('height', '100%')
        .attr('viewBox', `0 0 ${width} ${height}`)
        .attr('preserveAspectRatio', 'xMidYMid meet')

      this.g = this.svg.append('g')

      this.zoom = d3.zoom()
        .scaleExtent([0.1, 4])
        .on('zoom', (event) => {
          this.g.attr('transform', event.transform)
        })

      this.svg.call(this.zoom)

      // ── Hub detection for mini-graph ────────────────────────────────
      const maxDegree = Math.max(1, ...this.nodes.map(n => n.degree || 0))
      this.nodes.forEach(n => {
        n.isHub = n.degree >= maxDegree * 0.35
      })

      this.simulation = d3.forceSimulation(this.nodes)
        .force('link', d3.forceLink(this.links).id(d => d.id).distance(45).strength(0.08))
        .force('charge', d3.forceManyBody().strength(-120))
        .force('center', d3.forceCenter(width / 2, height / 2))
        .force('collision', d3.forceCollide().radius(d => (d.radius || 5) + 8))

      // ── Constellation lines ──────────────────────────────────────────
      const link = this.g.append('g')
        .selectAll('line')
        .data(this.links)
        .enter()
        .append('line')
        .attr('stroke', 'rgba(160, 190, 255, 0.3)')
        .attr('stroke-width', 0.7)

      // ── Star nodes ──────────────────────────────────────────────────
      const currentNoteId = this.note.id

      const node = this.g.append('g')
        .selectAll('g')
        .data(this.nodes)
        .enter()
        .append('g')
        .style('cursor', 'pointer')
        .on('click', (event, d) => {
          if (d.id !== this.note.id) {
            this.$router.push(`/note/${encodeURIComponent(d.id)}`)
          }
        })
        .call(d3.drag()
          .on('start', this.dragStarted)
          .on('drag', this.dragged)
          .on('end', this.dragEnded))

      // Outer glow ring
      node.append('circle')
        .attr('class', 'star-glow3')
        .attr('r', d => d.radius * (d.id === currentNoteId ? 7 : d.isHub ? 6 : 5))
        .attr('fill', d => d.id === currentNoteId ? '#ffffff' : getNodeColor(d))
        .attr('opacity', d => d.id === currentNoteId ? 0.08 : d.isHub ? 0.06 : 0.04)
        .style('pointer-events', 'none')

      // Mid glow ring
      node.append('circle')
        .attr('class', 'star-halo')
        .attr('r', d => d.radius * (d.id === currentNoteId ? 3.8 : d.isHub ? 3.5 : 2.8))
        .attr('fill', d => d.id === currentNoteId ? '#c8d8ff' : getNodeColor(d))
        .attr('opacity', d => d.id === currentNoteId ? 0.18 : d.isHub ? 0.13 : 0.08)
        .style('pointer-events', 'none')

      // Core star
      node.append('circle')
        .attr('class', 'star-core')
        .attr('r', d => d.radius)
        .attr('fill', d => d.id === currentNoteId ? '#e8f0ff' : getNodeColor(d))

      // Diffraction spikes for hub nodes and current note
      node.filter(d => d.isHub || d.id === currentNoteId).append('line')
        .attr('x1', d => -d.radius * 3).attr('y1', 0)
        .attr('x2', d => d.radius * 3).attr('y2', 0)
        .attr('stroke', d => d.id === currentNoteId ? '#c8d8ff' : getNodeColor(d))
        .attr('stroke-width', 0.7)
        .attr('opacity', 0.5)
        .style('pointer-events', 'none')

      node.filter(d => d.isHub || d.id === currentNoteId).append('line')
        .attr('x1', 0).attr('y1', d => -d.radius * 3)
        .attr('x2', 0).attr('y2', d => d.radius * 3)
        .attr('stroke', d => d.id === currentNoteId ? '#c8d8ff' : getNodeColor(d))
        .attr('stroke-width', 0.7)
        .attr('opacity', 0.5)
        .style('pointer-events', 'none')

      // Labels
      node.append('text')
        .text(d => d.title || d.id.split('/').pop())
        .attr('x', d => d.radius + 4)
        .attr('y', 4)
        .attr('font-size', d => d.id === currentNoteId ? '11px' : '9px')
        .attr('font-weight', d => d.id === currentNoteId ? '600' : '400')
        .attr('fill', 'rgba(200, 220, 255, 0.9)')
        .attr('pointer-events', 'none')
        .attr('opacity', d => d.id === currentNoteId ? 0.9 : 0)
        .attr('letter-spacing', '0.02em')

      node
        .on('mouseenter', function(event, d) {
          d3.select(this).select('text').attr('opacity', 1)
          d3.select(this).select('.star-core').attr('r', d.radius * 1.8)
          d3.select(this).select('.star-halo').attr('opacity', 0.28)
        })
        .on('mouseleave', function(event, d) {
          d3.select(this).select('text').attr('opacity', d.id === currentNoteId ? 0.9 : 0)
          d3.select(this).select('.star-core').attr('r', d.radius)
          d3.select(this).select('.star-halo').attr('opacity', d.id === currentNoteId ? 0.18 : d.isHub ? 0.13 : 0.08)
        })

      this.simulation.on('tick', () => {
        link
          .attr('x1', d => d.source.x)
          .attr('y1', d => d.source.y)
          .attr('x2', d => d.target.x)
          .attr('y2', d => d.target.y)
        node.attr('transform', d => `translate(${d.x},${d.y})`)
      })

      // Auto-fit after simulation settles
      setTimeout(() => {
        if (!this.svg) return
        const bounds = this.g.node().getBBox()
        if (bounds.width === 0) return
        const scale = 0.85 / Math.max(bounds.width / width, bounds.height / height)
        const transform = d3.zoomIdentity
          .translate(width / 2, height / 2)
          .scale(scale)
          .translate(-(bounds.x + bounds.width / 2), -(bounds.y + bounds.height / 2))
        this.svg.transition().duration(750).call(this.zoom.transform, transform)
      }, 300)
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
    }
  }
}
</script>

<style scoped>
.right-sidebar {
  width: 300px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 2rem;
  padding: 1rem 0 1rem 2rem;
  border-left: 1px solid var(--border-light);
}

.sidebar-section h3 {
  font-size: 0.85rem;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: var(--text-tertiary);
  margin-bottom: 1rem;
  font-weight: 600;
}

.mini-graph-container {
  height: 250px;
  background: radial-gradient(ellipse at 40% 40%, rgba(18, 12, 55, 0.95) 0%, rgba(4, 5, 18, 1) 70%);
  border: 1px solid rgba(100, 140, 255, 0.2);
  border-radius: 12px;
  overflow: hidden;
  position: relative;
  box-shadow: inset 0 2px 10px rgba(0,0,0,0.3);
}

.star-canvas {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.graph-svg {
  width: 100%;
  height: 100%;
  cursor: grab;
}

.graph-svg:active {
  cursor: grabbing;
}

.loading, .error {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  font-size: 0.9rem;
}

.toc-nav {
  max-height: calc(100vh - 400px);
  overflow-y: auto;
  padding-right: 10px;
}

.toc-nav::-webkit-scrollbar {
  width: 4px;
}

.toc-nav::-webkit-scrollbar-track {
  background: transparent;
}

.toc-nav::-webkit-scrollbar-thumb {
  background: var(--border-medium);
  border-radius: 4px;
}

.toc-nav ul {
  list-style: none;
  padding: 0;
  margin: 0;
  position: relative;
}

/* Vertical line for toc */
.toc-nav ul::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 2px;
  width: 1px;
  background: var(--border-light);
}

.toc-nav li {
  margin-bottom: 0.5rem;
  position: relative;
}

.toc-nav a {
  display: block;
  color: var(--text-secondary);
  text-decoration: none;
  font-size: 0.9rem;
  line-height: 1.4;
  transition: all 0.2s ease;
  border-left: 2px solid transparent;
  padding: 4px 0;
}

.toc-nav a:hover {
  color: var(--text-primary);
}

/* Indentation based on heading level */
.toc-level-1 a { padding-left: 1rem; font-weight: 500; }
.toc-level-2 a { padding-left: 1.5rem; }
.toc-level-3 a { padding-left: 2rem; font-size: 0.85rem; }
.toc-level-4 a { padding-left: 2.5rem; font-size: 0.85rem; color: var(--text-tertiary); }
.toc-level-5 a { padding-left: 3rem; font-size: 0.8rem; color: var(--text-tertiary); }
.toc-level-6 a { padding-left: 3.5rem; font-size: 0.8rem; color: var(--text-tertiary); }

.no-headers {
  color: var(--text-tertiary);
  font-size: 0.9rem;
  font-style: italic;
}

@media (max-width: 1024px) {
  .right-sidebar {
    display: none; /* Hide on smaller screens for now */
  }
}
</style>
