<template>
  <aside class="right-sidebar">
    <div class="sidebar-section mini-graph-section">
      <h3>Interactive Graph</h3>
      <div class="mini-graph-container" ref="graphContainer">
        <div v-if="loading" class="loading">Loading...</div>
        <div v-else-if="error" class="error">{{ error }}</div>
        <svg v-else ref="svg" class="graph-svg"></svg>
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
        
        this.nodes = data.nodes.filter(n => connectedIds.has(n.id)).map(n => ({ ...n }))
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
      
      // Fixed small dimensions or fluid
      const width = container.clientWidth || 300
      const height = container.clientHeight || 250
      
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
      
      this.simulation = d3.forceSimulation(this.nodes)
        .force('link', d3.forceLink(this.links).id(d => d.id).distance(30))
        .force('charge', d3.forceManyBody().strength(-100))
        .force('center', d3.forceCenter(width / 2, height / 2))
        .force('collision', d3.forceCollide().radius(15))
        
      const link = this.g.append('g')
        .selectAll('line')
        .data(this.links)
        .enter()
        .append('line')
        .attr('stroke', 'rgba(138, 92, 245, 0.3)')
        .attr('stroke-width', 1.5)
        
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
          
      node.append('circle')
        .attr('r', d => d.id === this.note.id ? 8 : 5)
        .attr('fill', d => d.id === this.note.id ? '#f0f0ff' : getNodeColor(d))
        .attr('stroke', 'var(--bg-primary)')
        .attr('stroke-width', 1.5)

      node.append('text')
        .text(d => d.title || d.id.split('/').pop())
        .attr('x', d => d.id === this.note.id ? 11 : 8)
        .attr('y', 4)
        .attr('font-size', d => d.id === this.note.id ? '11px' : '9px')
        .attr('font-weight', d => d.id === this.note.id ? '600' : '400')
        .attr('fill', 'rgba(220, 215, 255, 1)')
        .attr('pointer-events', 'none')
        .attr('opacity', 0.2)
        .style('text-shadow', '0 1px 3px rgba(0,0,0,0.9)')

      const currentNoteId = this.note.id

      node
        .on('mouseenter', function() {
          d3.select(this).select('text')
            .transition().duration(150)
            .attr('opacity', 1)
          d3.select(this).select('circle')
            .transition().duration(150)
            .attr('r', d => d.id === currentNoteId ? 10 : 7)
        })
        .on('mouseleave', function() {
          d3.select(this).select('text')
            .transition().duration(200)
            .attr('opacity', 0)
          d3.select(this).select('circle')
            .transition().duration(200)
            .attr('r', d => d.id === currentNoteId ? 8 : 5)
        })



        
      this.simulation.on('tick', () => {
        link
          .attr('x1', d => d.source.x)
          .attr('y1', d => d.source.y)
          .attr('x2', d => d.target.x)
          .attr('y2', d => d.target.y)
          
        node.attr('transform', d => `translate(${d.x},${d.y})`)
      })
      
      // Auto-fit after simulation starts to settle
      setTimeout(() => {
        if (!this.svg) return
        
        // Find bounds
        const bounds = this.g.node().getBBox()
        if (bounds.width === 0) return
        
        const padding = 20
        const scale = 0.9 / Math.max(bounds.width / width, bounds.height / height)
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
  background: rgba(12, 13, 29, 0.4);
  border: 1px solid rgba(138, 92, 245, 0.2);
  border-radius: 12px;
  overflow: hidden;
  position: relative;
  box-shadow: inset 0 2px 10px rgba(0,0,0,0.2);
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
