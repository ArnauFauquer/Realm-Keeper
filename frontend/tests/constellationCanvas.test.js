// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as d3 from 'd3'
import {
  buildAdjacency,
  createConstellationCanvas,
  isLinkLit,
  resolveNodeStyle
} from '@/composables/constellationCanvas'

function makeNodes() {
  return [
    { id: 'a', title: 'A', type: 'npc', degree: 3, radius: 6, isHub: true, x: 100, y: 100 },
    { id: 'b', title: 'B', type: 'npc', degree: 1, radius: 4, isHub: false, x: 200, y: 100 },
    { id: 'c', title: 'C', type: '', degree: 1, radius: 4, isHub: false, x: 300, y: 300 }
  ]
}

function makeLinks(nodes, resolved = true) {
  const [a, b, c] = nodes
  return resolved
    ? [{ source: a, target: b }, { source: a, target: c }]
    : [{ source: 'a', target: 'b' }, { source: 'a', target: 'c' }]
}

const NO_HIGHLIGHT = { hoverNode: null, neighbors: new Set(), highlightedType: null }

describe('buildAdjacency', () => {
  it('maps every node to its neighbours, from ids or resolved objects', () => {
    const nodes = makeNodes()
    for (const links of [makeLinks(nodes, false), makeLinks(nodes, true)]) {
      const adjacency = buildAdjacency(links)
      expect([...adjacency.get('a')]).toEqual(['b', 'c'])
      expect([...adjacency.get('b')]).toEqual(['a'])
      expect([...adjacency.get('c')]).toEqual(['a'])
    }
  })
})

describe('resolveNodeStyle', () => {
  const [hub, leaf, untyped] = makeNodes()

  it('uses the resting style when nothing is highlighted', () => {
    expect(resolveNodeStyle(hub, NO_HIGHLIGHT)).toEqual({
      radius: 6, coreAlpha: 1, haloAlpha: 0.13, glowAlpha: 0.06, textAlpha: 0.45
    })
    expect(resolveNodeStyle(leaf, NO_HIGHLIGHT)).toMatchObject({ haloAlpha: 0.08, glowAlpha: 0.04, textAlpha: 0.15 })
  })

  it('grows the hovered node, keeps neighbours lit and fades the rest', () => {
    const state = { hoverNode: leaf, neighbors: new Set(['a']), highlightedType: null }
    expect(resolveNodeStyle(leaf, state)).toMatchObject({ radius: 4 * 1.8, coreAlpha: 1, textAlpha: 1 })
    expect(resolveNodeStyle(hub, state)).toMatchObject({ radius: 6, coreAlpha: 1, textAlpha: 1 })
    expect(resolveNodeStyle(untyped, state)).toMatchObject({ coreAlpha: 0.15, haloAlpha: 0.01, textAlpha: 0.03 })
  })

  it('emphasises nodes of the selected type and fades the others', () => {
    const state = { hoverNode: null, neighbors: new Set(), highlightedType: 'npc' }
    expect(resolveNodeStyle(hub, state)).toMatchObject({ radius: 6 * 1.4, coreAlpha: 1, haloAlpha: 0.2, textAlpha: 1 })
    expect(resolveNodeStyle(untyped, state)).toMatchObject({ radius: 4 * 0.6, coreAlpha: 0.1, textAlpha: 0.03 })
  })

  it('lets notes without a type be selected through the empty-string key', () => {
    const state = { hoverNode: null, neighbors: new Set(), highlightedType: '' }
    expect(resolveNodeStyle(untyped, state).coreAlpha).toBe(1)
    expect(resolveNodeStyle(hub, state).coreAlpha).toBe(0.1)
  })

  it('ignores hover while a type is selected', () => {
    const state = { hoverNode: leaf, neighbors: new Set(['a']), highlightedType: 'npc' }
    expect(resolveNodeStyle(leaf, state).radius).toBe(4 * 1.4)
  })

  it('does not mutate the node', () => {
    const before = { ...hub }
    resolveNodeStyle(hub, { hoverNode: hub, neighbors: new Set(), highlightedType: null })
    expect(hub).toEqual(before)
  })
})

describe('isLinkLit', () => {
  const nodes = makeNodes()
  const [toB, toC] = makeLinks(nodes)

  it('returns null when nothing is highlighted', () => {
    expect(isLinkLit(toB, NO_HIGHLIGHT)).toBeNull()
  })

  it('lights links touching the hovered node', () => {
    const state = { hoverNode: nodes[1], neighbors: new Set(['a']), highlightedType: null }
    expect(isLinkLit(toB, state)).toBe(true)
    expect(isLinkLit(toC, state)).toBe(false)
  })

  it('lights links with an endpoint of the selected type', () => {
    expect(isLinkLit(toC, { ...NO_HIGHLIGHT, highlightedType: 'npc' })).toBe(true)
    expect(isLinkLit(toC, { ...NO_HIGHLIGHT, highlightedType: 'location' })).toBe(false)
    expect(isLinkLit(toC, { ...NO_HIGHLIGHT, highlightedType: '' })).toBe(true)
  })
})

describe('createConstellationCanvas', () => {
  let canvas, ctx, simulation, nodes, links, onNodeClick, renderer

  function mouse(type, x, y, init = {}) {
    const rect = canvas.getBoundingClientRect()
    const event = new MouseEvent(type, { bubbles: true, clientX: rect.left + x, clientY: rect.top + y, ...init })
    // jsdom rejects `view` in the constructor under vitest, but d3-drag/zoom read event.view.document.
    Object.defineProperty(event, 'view', { value: window })
    return event
  }

  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', cb => setTimeout(() => cb(performance.now()), 0))
    vi.stubGlobal('cancelAnimationFrame', id => clearTimeout(id))

    ctx = new Proxy({}, {
      get: (target, prop) => {
        if (!(prop in target)) target[prop] = vi.fn()
        return target[prop]
      },
      set: (target, prop, value) => { target[prop] = value; return true }
    })
    canvas = document.createElement('canvas')
    document.body.appendChild(canvas)
    canvas.getContext = () => ctx
    Object.defineProperty(canvas, 'clientWidth', { value: 800, configurable: true })
    Object.defineProperty(canvas, 'clientHeight', { value: 600, configurable: true })

    nodes = makeNodes()
    links = makeLinks(nodes, false)
    simulation = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(links).id(d => d.id))
      .stop()
    nodes.forEach((node, i) => { node.x = [100, 200, 300][i]; node.y = [100, 100, 300][i] })
    onNodeClick = vi.fn()
    renderer = createConstellationCanvas({ canvas, simulation, nodes, links, getColor: () => '#fff', onNodeClick })
  })

  afterEach(() => {
    renderer.destroy()
    canvas.remove()
    vi.unstubAllGlobals()
  })

  it('sizes the backing store to the css size', () => {
    expect(canvas.width).toBe(800)
    expect(canvas.height).toBe(600)
  })

  it('finds the node under a screen point and nothing in empty space', () => {
    expect(renderer.nodeAt(100, 100)).toBe(nodes[0])
    expect(renderer.nodeAt(203, 98)).toBe(nodes[1])
    expect(renderer.nodeAt(500, 500)).toBeNull()
  })

  it('draws one batched path for all links when nothing is highlighted', () => {
    renderer.draw()
    // One stroke for every link together, plus one for the single hub's spikes.
    expect(ctx.stroke).toHaveBeenCalledTimes(2)
    expect(ctx.fillText).toHaveBeenCalled()
  })

  it('draws without throwing in every highlight mode', () => {
    renderer.draw()
    renderer.setHighlightedType('npc')
    renderer.draw()
    renderer.setHighlightedType('')
    renderer.draw()
    renderer.setHighlightedType(null)
    canvas.dispatchEvent(mouse('pointermove', 100, 100))
    renderer.draw()
    expect(canvas.style.cursor).toBe('pointer')
  })

  it('shows a pointer cursor while hovering a node and resets on leave', () => {
    canvas.dispatchEvent(mouse('pointermove', 100, 100))
    expect(canvas.style.cursor).toBe('pointer')
    canvas.dispatchEvent(mouse('pointermove', 500, 500))
    expect(canvas.style.cursor).toBe('')
    canvas.dispatchEvent(mouse('pointermove', 100, 100))
    canvas.dispatchEvent(new Event('pointerleave'))
    expect(canvas.style.cursor).toBe('')
  })

  it('moves hover along when nodes move under a stationary cursor', () => {
    canvas.dispatchEvent(mouse('pointermove', 100, 100))
    expect(canvas.style.cursor).toBe('pointer')
    nodes[0].x = 600 // simulation moved the node away
    renderer.draw()
    expect(canvas.style.cursor).toBe('')
    nodes[1].x = 100 // another one drifts under the cursor
    nodes[1].y = 100
    renderer.draw()
    expect(canvas.style.cursor).toBe('pointer')
  })

  it('ignores hover while a type is selected', () => {
    renderer.setHighlightedType('npc')
    canvas.dispatchEvent(mouse('pointermove', 100, 100))
    expect(canvas.style.cursor).toBe('')
  })

  it('calls onNodeClick only when a node is clicked', () => {
    canvas.dispatchEvent(mouse('click', 500, 500))
    expect(onNodeClick).not.toHaveBeenCalled()
    canvas.dispatchEvent(mouse('click', 200, 100))
    expect(onNodeClick).toHaveBeenCalledWith(nodes[1])
  })

  it('redraws on simulation ticks and stops after destroy', async () => {
    ctx.clearRect.mockClear()
    simulation.on('tick.canvas')()
    await new Promise(resolve => setTimeout(resolve, 5))
    expect(ctx.clearRect).toHaveBeenCalledTimes(1)

    renderer.destroy()
    expect(simulation.on('tick.canvas')).toBeUndefined()
    ctx.clearRect.mockClear()
    renderer.requestDraw()
    await new Promise(resolve => setTimeout(resolve, 5))
    expect(ctx.clearRect).not.toHaveBeenCalled()
  })

  it('leaves the caller\'s own tick listeners in place on destroy', () => {
    const own = vi.fn()
    simulation.on('tick', own)
    renderer.destroy()
    expect(simulation.on('tick')).toBe(own)
  })

  it('pins a dragged node to the pointer in world coordinates and releases it after', () => {
    const start = mouse('mousedown', 100, 100, { button: 0 })
    canvas.dispatchEvent(start)
    expect(nodes[0].fx).toBe(100)
    window.dispatchEvent(mouse('mousemove', 140, 130))
    expect(nodes[0].fx).toBe(140)
    expect(nodes[0].fy).toBe(130)
    window.dispatchEvent(mouse('mouseup', 140, 130))
    expect(nodes[0].fx).toBeNull()
    expect(nodes[0].fy).toBeNull()
  })

  it('does not start a node drag on empty space (so the view can pan)', () => {
    canvas.dispatchEvent(mouse('mousedown', 500, 500, { button: 0 }))
    expect(nodes.every(node => node.fx === undefined)).toBe(true)
  })
})
