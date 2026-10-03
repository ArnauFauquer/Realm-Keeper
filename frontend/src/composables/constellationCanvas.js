/**
 * Canvas 2D renderer for the full Constellation view (the note/link knowledge graph).
 *
 * The graph used to be drawn as ~2,400 SVG elements, and every simulation tick
 * rewrote the attributes of ~1,350 of them. Here the whole scene is painted
 * into a single <canvas> instead, so a frame costs a few milliseconds no matter
 * how many nodes there are. The d3-force simulation, d3-zoom and d3-drag are
 * still used for physics and input; only the drawing changed.
 *
 * The renderer is pure JS (no Vue) so none of the per-tick state passes through
 * Vue's reactivity proxies.
 */
import * as d3 from 'd3'
import { getLinkEndpointId } from '@/composables/useConstellationGraph'

const LINK_COLOR = 'rgba(160, 190, 255, 0.3)'
const LINK_WIDTH = 0.8
const LINK_HOVER_COLOR = 'rgba(200, 225, 255, 0.85)'
const LINK_HOVER_WIDTH = 1.2
const LINK_HOVER_DIM_COLOR = 'rgba(100, 130, 200, 0.08)'
const LINK_HOVER_DIM_WIDTH = 0.5
const LINK_TYPE_COLOR = 'rgba(180, 210, 255, 0.7)'
const LINK_TYPE_WIDTH = 1.1
const LINK_TYPE_DIM_COLOR = 'rgba(100, 130, 200, 0.04)'
const LINK_TYPE_DIM_WIDTH = 0.4

const TEXT_COLOR = 'rgb(200, 220, 255)'
const TEXT_BASE_ALPHA = 0.9
// Below this zoom level only labels that are already prominent are drawn.
const LABEL_LOD_ZOOM = 0.5
const LABEL_LOD_MIN_ALPHA = 0.3
const LABEL_MIN_ALPHA = 0.05

const MAX_DPR = 2

/** id -> Set of ids of the notes directly linked to it. */
export function buildAdjacency(links) {
  const adjacency = new Map()
  const add = (from, to) => {
    let set = adjacency.get(from)
    if (!set) {
      set = new Set()
      adjacency.set(from, set)
    }
    set.add(to)
  }
  links.forEach(link => {
    const sourceId = getLinkEndpointId(link.source)
    const targetId = getLinkEndpointId(link.target)
    add(sourceId, targetId)
    add(targetId, sourceId)
  })
  return adjacency
}

/** Types are matched on `type || ''` so notes without a type can be selected too. */
export function nodeTypeKey(node) {
  return node.type || ''
}

/**
 * Visual state of a node: radius and the alpha of each layer (core, halo, outer
 * glow, label). Mirrors the previous SVG behaviour:
 *  - a type is selected: matching nodes grow and stay bright, the rest fade;
 *  - a node is hovered: it and its neighbours stay bright, the rest fade.
 * `state` is `{ hoverNode, neighbors, highlightedType }`.
 */
export function resolveNodeStyle(node, state, out = {}) {
  const hub = node.isHub
  out.radius = node.radius
  out.coreAlpha = 1
  out.haloAlpha = hub ? 0.13 : 0.08
  out.glowAlpha = hub ? 0.06 : 0.04
  out.textAlpha = node.degree > 2 ? 0.45 : 0.15

  if (state.highlightedType !== null) {
    if (nodeTypeKey(node) === state.highlightedType) {
      out.radius = node.radius * 1.4
      out.haloAlpha = hub ? 0.2 : 0.15
      out.glowAlpha = hub ? 0.08 : 0.05
      out.textAlpha = 1
    } else {
      out.radius = node.radius * 0.6
      out.coreAlpha = 0.1
      out.haloAlpha = 0.01
      out.glowAlpha = 0.01
      out.textAlpha = 0.03
    }
  } else if (state.hoverNode) {
    const lit = node === state.hoverNode || state.neighbors.has(node.id)
    if (node === state.hoverNode) out.radius = node.radius * 1.8
    if (lit) {
      out.textAlpha = 1
    } else {
      out.coreAlpha = 0.15
      out.haloAlpha = 0.01
      out.glowAlpha = 0.01
      out.textAlpha = 0.03
    }
  }
  return out
}

/** Whether a link is emphasised (`true`) or faded (`false`); `null` when nothing is highlighted. */
export function isLinkLit(link, state) {
  if (state.highlightedType !== null) {
    return nodeTypeKey(link.source) === state.highlightedType ||
      nodeTypeKey(link.target) === state.highlightedType
  }
  if (state.hoverNode) {
    return link.source === state.hoverNode || link.target === state.hoverNode
  }
  return null
}

export function createConstellationCanvas({ canvas, simulation, nodes, links, getColor, onNodeClick }) {
  const ctx = canvas.getContext('2d')
  const adjacency = buildAdjacency(links)
  const colors = nodes.map(getColor)
  const style = {}
  const fontFamily = getComputedStyle(canvas).getPropertyValue('--font-body').trim() || 'sans-serif'

  const state = { hoverNode: null, neighbors: new Set(), highlightedType: null }
  let transform = d3.zoomIdentity
  let width = 0
  let height = 0
  let dpr = 1
  let frame = 0
  let destroyed = false
  // Last mouse position over the canvas, so hover can follow nodes that move
  // (simulation ticks, zoom) underneath a stationary cursor.
  let pointer = null

  // Per-node style is resolved once per frame and reused by every layer.
  const radii = new Float32Array(nodes.length)
  const coreAlphas = new Float32Array(nodes.length)
  const haloAlphas = new Float32Array(nodes.length)
  const glowAlphas = new Float32Array(nodes.length)
  const textAlphas = new Float32Array(nodes.length)

  function requestDraw() {
    if (frame || destroyed) return
    frame = requestAnimationFrame(draw)
  }

  function resize() {
    width = canvas.clientWidth
    height = canvas.clientHeight
    dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR)
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
    requestDraw()
  }

  function strokeLinks(predicate, color, lineWidth) {
    ctx.beginPath()
    for (let i = 0; i < links.length; i++) {
      const link = links[i]
      if (!predicate(link)) continue
      ctx.moveTo(link.source.x, link.source.y)
      ctx.lineTo(link.target.x, link.target.y)
    }
    ctx.strokeStyle = color
    ctx.lineWidth = lineWidth
    ctx.stroke()
  }

  function drawLinks() {
    if (state.highlightedType === null && !state.hoverNode) {
      strokeLinks(() => true, LINK_COLOR, LINK_WIDTH)
      return
    }
    const byType = state.highlightedType !== null
    strokeLinks(
      link => !isLinkLit(link, state),
      byType ? LINK_TYPE_DIM_COLOR : LINK_HOVER_DIM_COLOR,
      byType ? LINK_TYPE_DIM_WIDTH : LINK_HOVER_DIM_WIDTH
    )
    strokeLinks(
      link => isLinkLit(link, state),
      byType ? LINK_TYPE_COLOR : LINK_HOVER_COLOR,
      byType ? LINK_TYPE_WIDTH : LINK_HOVER_WIDTH
    )
  }

  function fillCircles(alphas, radiusFor) {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]
      ctx.globalAlpha = alphas[i]
      ctx.fillStyle = colors[i]
      ctx.beginPath()
      ctx.arc(node.x, node.y, radiusFor(node, i), 0, Math.PI * 2)
      ctx.fill()
    }
  }

  function drawSpikes() {
    ctx.lineWidth = 0.8
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]
      if (!node.isHub) continue
      const reach = radii[i] * 3
      ctx.globalAlpha = 0.5 * coreAlphas[i]
      ctx.strokeStyle = colors[i]
      ctx.beginPath()
      ctx.moveTo(node.x - reach, node.y)
      ctx.lineTo(node.x + reach, node.y)
      ctx.moveTo(node.x, node.y - reach)
      ctx.lineTo(node.x, node.y + reach)
      ctx.stroke()
    }
  }

  function drawLabels() {
    const lowZoom = transform.k < LABEL_LOD_ZOOM
    ctx.fillStyle = TEXT_COLOR
    ctx.textBaseline = 'alphabetic'
    let currentFont = ''
    for (let i = 0; i < nodes.length; i++) {
      const alpha = textAlphas[i]
      if (alpha < LABEL_MIN_ALPHA || (lowZoom && alpha < LABEL_LOD_MIN_ALPHA)) continue
      const node = nodes[i]
      const font = node.isHub
        ? `600 12px ${fontFamily}`
        : `400 10px ${fontFamily}`
      if (font !== currentFont) {
        ctx.font = font
        currentFont = font
      }
      ctx.globalAlpha = alpha * TEXT_BASE_ALPHA
      ctx.fillText(node.title, node.x + radii[i] + 6, node.y + 4)
    }
  }

  function draw() {
    frame = 0
    if (destroyed || !width || !height) return

    if (pointer && state.highlightedType === null) applyHoverNode(nodeAt(pointer[0], pointer[1]))

    for (let i = 0; i < nodes.length; i++) {
      resolveNodeStyle(nodes[i], state, style)
      radii[i] = style.radius
      coreAlphas[i] = style.coreAlpha
      haloAlphas[i] = style.haloAlpha
      glowAlphas[i] = style.glowAlpha
      textAlphas[i] = style.textAlpha
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.setTransform(dpr * transform.k, 0, 0, dpr * transform.k, dpr * transform.x, dpr * transform.y)

    ctx.globalAlpha = 1
    drawLinks()

    // Glow layers use the node's resting radius (hovering only grows the core).
    fillCircles(glowAlphas, node => node.radius * (node.isHub ? 6 : 5))
    fillCircles(haloAlphas, node => node.radius * (node.isHub ? 3.5 : 2.8))
    fillCircles(coreAlphas, (node, i) => radii[i])
    drawSpikes()
    drawLabels()
    ctx.globalAlpha = 1
  }

  // ── Input ──────────────────────────────────────────────────────────────

  /** Closest node under a point in canvas (screen) coordinates, or null. */
  function nodeAt(screenX, screenY) {
    const x = transform.invertX(screenX)
    const y = transform.invertY(screenY)
    let best = null
    let bestDistance = Infinity
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]
      const reach = (node.radius * 1.5 + 4) / transform.k
      const dx = node.x - x
      const dy = node.y - y
      const distance = dx * dx + dy * dy
      if (distance <= reach * reach && distance < bestDistance) {
        best = node
        bestDistance = distance
      }
    }
    return best
  }

  function pointerPosition(event) {
    const rect = canvas.getBoundingClientRect()
    return [event.clientX - rect.left, event.clientY - rect.top]
  }

  function applyHoverNode(node) {
    if (state.hoverNode === node) return false
    state.hoverNode = node
    state.neighbors = node ? (adjacency.get(node.id) || new Set()) : new Set()
    canvas.style.cursor = node ? 'pointer' : ''
    return true
  }

  function setHoverNode(node) {
    if (applyHoverNode(node)) requestDraw()
  }

  function onPointerMove(event) {
    // Touch has no hover; a tap goes straight to the click handler.
    if (event.pointerType === 'touch') return
    pointer = pointerPosition(event)
    if (state.highlightedType === null) setHoverNode(nodeAt(pointer[0], pointer[1]))
  }

  function onPointerLeave() {
    pointer = null
    setHoverNode(null)
  }

  function onClick(event) {
    const node = nodeAt(...pointerPosition(event))
    if (node) onNodeClick(node)
  }

  const drag = d3.drag()
    .container(canvas)
    .subject(event => {
      const node = nodeAt(event.x, event.y)
      return node && { node, x: transform.applyX(node.x), y: transform.applyY(node.y) }
    })
    .on('start', event => {
      if (!event.active) simulation.alphaTarget(0.3).restart()
      event.subject.node.fx = event.subject.node.x
      event.subject.node.fy = event.subject.node.y
    })
    .on('drag', event => {
      event.subject.node.fx = transform.invertX(event.x)
      event.subject.node.fy = transform.invertY(event.y)
    })
    .on('end', event => {
      if (!event.active) simulation.alphaTarget(0)
      event.subject.node.fx = null
      event.subject.node.fy = null
    })

  const zoom = d3.zoom()
    .scaleExtent([0.05, 10])
    .on('zoom', event => {
      transform = event.transform
      requestDraw()
    })

  // The drag behaviour must be registered first: when it grabs a node it stops
  // the event, so the zoom behaviour only pans when the pointer is on empty space.
  d3.select(canvas).call(drag).call(zoom)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerleave', onPointerLeave)
  canvas.addEventListener('click', onClick)

  const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null
  resizeObserver?.observe(canvas)
  simulation.on('tick', requestDraw)
  resize()

  return {
    draw,
    nodeAt,
    requestDraw,
    getTransform: () => transform,
    setHighlightedType(type) {
      state.highlightedType = type
      if (type !== null) setHoverNode(null)
      requestDraw()
    },
    destroy() {
      destroyed = true
      if (frame) cancelAnimationFrame(frame)
      frame = 0
      resizeObserver?.disconnect()
      simulation.on('tick', null)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerleave', onPointerLeave)
      canvas.removeEventListener('click', onClick)
      d3.select(canvas).on('.drag', null).on('.zoom', null)
    }
  }
}
