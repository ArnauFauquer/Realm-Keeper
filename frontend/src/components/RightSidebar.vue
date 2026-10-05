<template>
  <aside class="right-sidebar">
    <div class="sidebar-section mini-graph-section">
      <div class="section-header">
        <h3 class="rk-overline">Constellation</h3>
        <button class="rk-btn rk-btn--ghost rk-btn--sm full-graph-link" aria-label="Open full constellation" title="Open full constellation" @click="openGraphModal">
          <span class="full-graph-label">Full constellation</span>
          <span class="mdi mdi-arrow-expand"></span>
        </button>
      </div>
      <div class="mini-graph-container" ref="graphContainer">
        <div v-if="loading" class="graph-state" aria-busy="true"><span class="rk-spinner" role="status" aria-label="Loading constellation"></span></div>
        <div v-else-if="error" class="graph-state graph-error"><span class="mdi mdi-graph-outline"></span><span>{{ error }}</span></div>
        <template v-else>
          <canvas ref="starCanvas" class="star-canvas"></canvas>
          <svg ref="svg" class="graph-svg"></svg>
        </template>
      </div>
    </div>
    
    <div class="sidebar-section toc-section">
      <h3 class="rk-overline">On this page</h3>
      <nav class="toc-nav" aria-label="Table of contents">
        <ul v-if="headers.length">
          <li v-for="header in headers" :key="header.id" :class="[`toc-level-${header.level}`, { active: header.id === activeId }]">
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
import { apiUrl } from '@/config/env'
import { slugifyHeading, stripInlineLinkSyntax } from '@/utils/slugify'
import { getNodeColor } from '../config/nodeColors'
import { drawStarfield, getLinkEndpointId, computeDegrees, createDragHandlers } from '@/composables/useConstellationGraph'
import { useGraphModal } from '@/composables/useGraphModal'
import { noteRoute } from '@/utils/noteUrls'

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
      zoom: null,
      activeId: null,
      headingObserver: null,
      headingTimer: null
    }
  },
  computed: {
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
          const rawText = match[2].trim()
          const text = stripInlineLinkSyntax(rawText)
          const id = slugifyHeading(rawText, headerCount)
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
    },
    headers() {
      this.observeHeadings()
    }
  },
  mounted() {
    this.observeHeadings()
  },
  beforeUnmount() {
    if (this.simulation) {
      this.simulation.stop()
    }
    if (this.headingObserver) this.headingObserver.disconnect()
    clearTimeout(this.headingTimer)
  },
  methods: {
    // Highlights the TOC entry for the heading nearest the top of the
    // note's scroll area. The note renders its HTML asynchronously, so wait a
    // frame after the header list changes before looking the ids up.
    observeHeadings() {
      if (this.headingObserver) this.headingObserver.disconnect()
      clearTimeout(this.headingTimer)
      this.activeId = null
      if (!this.headers.length || typeof IntersectionObserver === 'undefined') return
      this.headingTimer = setTimeout(() => {
        const els = this.headers.map(h => document.getElementById(h.id)).filter(Boolean)
        if (!els.length) return
        this.headingObserver = new IntersectionObserver((entries) => {
          const visible = entries.filter(e => e.isIntersecting)
          if (visible.length) {
            visible.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
            this.activeId = visible[0].target.id
          }
        }, {
          root: document.querySelector('.main-content'),
          rootMargin: '0px 0px -70% 0px'
        })
        els.forEach(el => this.headingObserver.observe(el))
      }, 150)
    },
    openGraphModal() {
      useGraphModal().open()
    },
    scrollTo(id) {
      const element = document.getElementById(id)
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'start' })
        this.activeId = id
        // Update URL hash without jumping
        history.pushState(null, null, `#${id}`)
      }
    },
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
        
        const currentId = this.note.id
        
        // Find nodes connected to current node
        const connectedIds = new Set()
        connectedIds.add(currentId)
        
        const relevantLinks = []
        
        data.links.forEach(link => {
          const sourceId = getLinkEndpointId(link.source)
          const targetId = getLinkEndpointId(link.target)

          if (sourceId === currentId || targetId === currentId) {
            connectedIds.add(sourceId)
            connectedIds.add(targetId)
            relevantLinks.push({ ...link })
          }
        })

        // Calculate global connection count (degree) for each node
        const { degrees: globalDegrees } = computeDegrees(data.nodes, data.links)

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
        this.error = "Could not load constellation"
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
      drawStarfield(this.$refs.starCanvas, width, height, {
        density: 2000,
        sizeRanges: [[0.2, 0.6], [0.6, 1.1], [1.1, 1.8]],
        opacityRange: [0.12, 0.5]
      })

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
      const { dragStarted, dragged, dragEnded } = createDragHandlers(() => this.simulation)

      const node = this.g.append('g')
        .selectAll('g')
        .data(this.nodes)
        .enter()
        .append('g')
        .style('cursor', 'pointer')
        .on('click', (event, d) => {
          if (d.id !== this.note.id) {
            this.$router.push(noteRoute(d.id))
          }
        })
        .call(d3.drag()
          .on('start', dragStarted)
          .on('drag', dragged)
          .on('end', dragEnded))

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
    }
  }
}
</script>

<style scoped>
.right-sidebar {
  width: var(--aside-width);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
  padding: var(--space-6) 0 var(--space-6) var(--space-6);
  border-left: 1px solid var(--border-light);
}

.sidebar-section h3 {
  margin-bottom: var(--space-3);
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  margin-bottom: var(--space-3);
}

.section-header h3 {
  margin-bottom: 0;
  white-space: nowrap;
}

.full-graph-link {
  flex-shrink: 0;
}

.mini-graph-container {
  position: relative;
  height: 240px;
  overflow: hidden;
  border-radius: var(--radius-lg);
  border: 1px solid rgba(100, 140, 255, 0.2);
  background: radial-gradient(ellipse at 40% 40%, rgba(18, 12, 55, 0.95) 0%, rgba(4, 5, 18, 1) 70%);
  box-shadow: inset 0 2px 10px rgba(4, 3, 20, 0.4);
}

.star-canvas {
  position: absolute;
  inset: 0;
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

.graph-state {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.graph-error .mdi {
  font-size: 1.5rem;
}

.toc-nav {
  max-height: calc(100dvh - 420px);
  overflow-y: auto;
  padding-right: var(--space-3);
}

.toc-nav ul {
  position: relative;
  list-style: none;
  border-left: 1px solid var(--border-light);
}

.toc-nav a {
  display: block;
  margin-left: -1px;
  padding: 5px 0 5px var(--toc-indent, var(--space-3));
  border-left: 2px solid transparent;
  color: var(--text-secondary);
  text-decoration: none;
  font-size: var(--text-sm);
  line-height: 1.4;
  transition: color var(--duration-fast) var(--ease-out), border-color var(--duration-fast) var(--ease-out);
}

.toc-nav a:hover {
  color: var(--text-primary);
  border-left-color: var(--border-medium);
}

.toc-nav li.active > a {
  color: var(--text-primary);
  border-left-color: var(--accent-hover);
}

/* Indentation based on heading level */
.toc-level-1 a { --toc-indent: var(--space-3); font-weight: 500; color: var(--text-primary); }
.toc-level-2 a { --toc-indent: var(--space-3); }
.toc-level-3 a { --toc-indent: var(--space-6); }
.toc-level-4 a,
.toc-level-5 a,
.toc-level-6 a { --toc-indent: var(--space-8); font-size: var(--text-xs); color: var(--text-muted); }

.no-headers {
  color: var(--text-muted);
  font-size: var(--text-sm);
}

@media (max-width: 1279px) {
  .right-sidebar {
    width: 232px;
    padding-left: var(--space-5);
  }

  .mini-graph-container {
    height: 200px;
  }

  .full-graph-label {
    display: none;
  }
}

@media (max-width: 1024px) {
  .right-sidebar {
    display: none;
  }
}
</style>