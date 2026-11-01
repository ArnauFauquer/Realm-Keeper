// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as d3 from 'd3'
import {
  applyPositions,
  buildMirrorGraph,
  createConstellationCanvas,
  decorateNodes,
  fitMirrorTransform
} from '@/composables/constellationCanvas'

describe('decorateNodes', () => {
  it('derives degree, radius and hubs from the links', () => {
    const nodes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]
    const links = [{ source: 'a', target: 'b' }, { source: 'a', target: 'c' }, { source: 'a', target: 'd' }]
    decorateNodes(nodes, links)
    expect(nodes.map(node => node.degree)).toEqual([3, 1, 1, 1])
    expect(nodes[0].radius).toBeCloseTo(2.5 + Math.sqrt(3) * 1.8)
    expect(nodes.map(node => node.isHub)).toEqual([true, false, false, false])
  })
})

describe('mirror graph', () => {
  const raw = {
    nodes: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }, { id: 'new', title: 'Added after the GM loaded' }],
    links: [{ source: 'a', target: 'b' }, { source: 'a', target: 'new' }]
  }
  const positions = { a: [10, 20], b: [30, 40] }

  it('places notes where the GM has them and drops what the GM has no position for', () => {
    const { nodes, links } = buildMirrorGraph(raw.nodes, raw.links, positions)
    expect(nodes.map(node => [node.id, node.x, node.y])).toEqual([['a', 10, 20], ['b', 30, 40]])
    expect(links).toHaveLength(1)
    expect(links[0].source).toBe(nodes[0])
    expect(links[0].target).toBe(nodes[1])
    expect(nodes[0].degree).toBe(1)
  })

  it('does not touch the fetched graph', () => {
    buildMirrorGraph(raw.nodes, raw.links, positions)
    expect(raw.nodes[0]).toEqual({ id: 'a', title: 'A' })
    expect(raw.links[0]).toEqual({ source: 'a', target: 'b' })
  })

  it('moves nodes to the latest positions', () => {
    const { nodes } = buildMirrorGraph(raw.nodes, raw.links, positions)
    applyPositions(nodes, { a: [100, 200] })
    expect(nodes.map(node => [node.x, node.y])).toEqual([[100, 200], [30, 40]])
  })
})

describe('fitMirrorTransform', () => {
  const view = { x: -300, y: -100, k: 2, width: 1000, height: 600 }

  it('keeps the GM view when the screen is the same size', () => {
    expect(fitMirrorTransform(view, 1000, 600)).toEqual({ x: -300, y: -100, k: 2 })
  })

  it('scales to a bigger screen of the same shape', () => {
    const t = fitMirrorTransform(view, 2000, 1200)
    expect(t.k).toBe(4)
    expect(t.x).toBeCloseTo(-600)
    expect(t.y).toBeCloseTo(-200)
  })

  it('centres on the same world point and never crops, whatever the aspect ratio', () => {
    const screen = [1920, 600]
    const t = fitMirrorTransform(view, ...screen)
    // The world point in the middle of the GM's viewport.
    const centre = [(1000 / 2 + 300) / 2, (600 / 2 + 100) / 2]
    expect(t.k).toBeCloseTo(2 * Math.min(1920 / 1000, 600 / 600))
    expect(centre[0] * t.k + t.x).toBeCloseTo(screen[0] / 2)
    expect(centre[1] * t.k + t.y).toBeCloseTo(screen[1] / 2)
    // The whole GM viewport still fits inside the screen.
    expect((1000 / view.k) * t.k).toBeLessThanOrEqual(screen[0] + 1e-6)
    expect((600 / view.k) * t.k).toBeLessThanOrEqual(screen[1] + 1e-6)
  })
})

function stubCanvas(width, height) {
  vi.stubGlobal('requestAnimationFrame', cb => setTimeout(() => cb(performance.now()), 0))
  vi.stubGlobal('cancelAnimationFrame', id => clearTimeout(id))
  const ctx = new Proxy({}, {
    get: (target, prop) => { if (!(prop in target)) target[prop] = vi.fn(); return target[prop] },
    set: (target, prop, value) => { target[prop] = value; return true }
  })
  const canvas = document.createElement('canvas')
  document.body.appendChild(canvas)
  canvas.getContext = () => ctx
  Object.defineProperty(canvas, 'clientWidth', { value: width, configurable: true })
  Object.defineProperty(canvas, 'clientHeight', { value: height, configurable: true })
  return { canvas, ctx }
}

function mouse(canvas, type, x, y) {
  const rect = canvas.getBoundingClientRect()
  const event = new MouseEvent(type, { bubbles: true, clientX: rect.left + x, clientY: rect.top + y })
  // jsdom rejects `view` in the constructor under vitest, but d3 reads event.view.
  Object.defineProperty(event, 'view', { value: window })
  return event
}

function makeGraph() {
  const nodes = [
    { id: 'a', title: 'A', type: 'npc', x: 100, y: 100 },
    { id: 'b', title: 'B', type: 'npc', x: 200, y: 100 },
    { id: 'c', title: 'C', type: '', x: 300, y: 300 }
  ]
  const links = [{ source: 'a', target: 'b' }, { source: 'a', target: 'c' }]
  decorateNodes(nodes, links)
  return { nodes, links }
}

describe('GM renderer feeding the screen', () => {
  let canvas, simulation, nodes, links, renderer

  beforeEach(() => {
    ;({ canvas } = stubCanvas(800, 600))
    ;({ nodes, links } = makeGraph())
    simulation = d3.forceSimulation(nodes).force('link', d3.forceLink(links).id(d => d.id)).stop()
    nodes.forEach((node, i) => { node.x = [100, 200, 300][i]; node.y = [100, 100, 300][i] })
  })

  afterEach(() => {
    renderer.destroy()
    canvas.remove()
    vi.unstubAllGlobals()
  })

  function create(extra = {}) {
    renderer = createConstellationCanvas({ canvas, simulation, nodes, links, getColor: () => '#fff', ...extra })
    return renderer
  }

  it('reports every visible change through onChange', () => {
    const onChange = vi.fn()
    create({ onChange })
    onChange.mockClear()

    renderer.setHighlightedType('npc')
    expect(onChange).toHaveBeenCalledTimes(1)
    renderer.setHighlightedType(null)
    onChange.mockClear()
    canvas.dispatchEvent(mouse(canvas, 'pointermove', 100, 100))
    expect(onChange).toHaveBeenCalled()
    onChange.mockClear()
    simulation.on('tick.canvas')()
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('snapshots the layout, view and highlights for the screen', () => {
    create()
    nodes[0].x = 100.26
    nodes[0].y = 99.94
    renderer.setHighlightedType('npc')
    const snapshot = renderer.getSnapshot()
    expect(snapshot.view).toEqual({ x: 0, y: 0, k: 1, width: 800, height: 600 })
    expect(snapshot.positions.a).toEqual([100.3, 99.9])
    expect(Object.keys(snapshot.positions)).toEqual(['a', 'b', 'c'])
    expect(snapshot.highlighted_type).toBe('npc')
    expect(snapshot.hover_id).toBeNull()

    renderer.setHighlightedType(null)
    canvas.dispatchEvent(mouse(canvas, 'pointermove', 200, 100))
    expect(renderer.getSnapshot().hover_id).toBe('b')
  })

  it('setView moves the view and is reflected in the snapshot and hit-testing', () => {
    create()
    renderer.setView({ x: 50, y: 20, k: 2 })
    expect(renderer.getTransform()).toMatchObject({ x: 50, y: 20, k: 2 })
    expect(renderer.getSnapshot().view).toMatchObject({ x: 50, y: 20, k: 2 })
    expect(renderer.nodeAt(250, 220)).toBe(nodes[0]) // world (100, 100) → screen (250, 220)
  })

  it('setHoverId hovers a node by id and clears on null or an unknown id', () => {
    create()
    renderer.setHoverId('b')
    expect(renderer.getSnapshot().hover_id).toBe('b')
    renderer.setHoverId('does-not-exist')
    expect(renderer.getSnapshot().hover_id).toBeNull()
    renderer.setHoverId('a')
    renderer.setHoverId(null)
    expect(renderer.getSnapshot().hover_id).toBeNull()
  })
})

describe('read-only mirror renderer', () => {
  let canvas, ctx, renderer, nodes, links

  beforeEach(() => {
    ;({ canvas, ctx } = stubCanvas(1920, 1080))
    ;({ nodes, links } = buildMirrorGraph(
      [{ id: 'a', title: 'A', type: 'npc' }, { id: 'b', title: 'B', type: 'npc' }],
      [{ source: 'a', target: 'b' }],
      { a: [100, 100], b: [200, 100] }
    ))
  })

  afterEach(() => {
    renderer?.destroy()
    canvas.remove()
    vi.unstubAllGlobals()
  })

  it('works without a simulation and takes no pointer input', () => {
    const onNodeClick = vi.fn()
    renderer = createConstellationCanvas({ canvas, nodes, links, getColor: () => '#fff', interactive: false, onNodeClick })
    renderer.draw()
    expect(ctx.fillText).toHaveBeenCalled()

    canvas.dispatchEvent(mouse(canvas, 'pointermove', 100, 100))
    canvas.dispatchEvent(mouse(canvas, 'click', 100, 100))
    expect(onNodeClick).not.toHaveBeenCalled()
    expect(canvas.style.cursor).toBe('')
  })

  it('takes its view and highlights from outside', () => {
    renderer = createConstellationCanvas({ canvas, nodes, links, getColor: () => '#fff', interactive: false })
    renderer.setView({ x: 10, y: 20, k: 3 })
    expect(renderer.getTransform()).toMatchObject({ x: 10, y: 20, k: 3 })
    renderer.setHoverId('a')
    renderer.setHighlightedType('npc')
    renderer.draw()
    expect(renderer.getSnapshot().highlighted_type).toBe('npc')
  })

  it('tells the owner when the screen is resized', () => {
    const onResize = vi.fn()
    renderer = createConstellationCanvas({ canvas, nodes, links, getColor: () => '#fff', interactive: false, onResize })
    expect(onResize).toHaveBeenCalledWith(1920, 1080)
  })
})
