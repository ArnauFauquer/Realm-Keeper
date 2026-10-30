import { describe, expect, it, vi } from 'vitest'
import { computeDegrees, createDragHandlers, drawStarfield, getLinkEndpointId } from '@/composables/useConstellationGraph'

describe('getLinkEndpointId', () => {
  it('takes an id, or the id of the node d3 swapped in', () => {
    expect(getLinkEndpointId('a')).toBe('a')
    expect(getLinkEndpointId({ id: 'b' })).toBe('b')
  })
})

describe('computeDegrees', () => {
  it('counts links per node, resolved or not, ignoring unknown nodes', () => {
    const nodes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    const links = [{ source: 'a', target: { id: 'b' } }, { source: { id: 'a' }, target: 'ghost' }]
    const { degrees, maxDegree } = computeDegrees(nodes, links)
    expect(degrees).toEqual({ a: 2, b: 1, c: 0 })
    expect(maxDegree).toBe(2)
  })

  it('has a max degree of at least 1 even with no links', () => {
    expect(computeDegrees([{ id: 'a' }], []).maxDegree).toBe(1)
    expect(computeDegrees([], []).maxDegree).toBe(1)
  })
})

describe('createDragHandlers', () => {
  const simulation = () => {
    const sim = { alphaTarget: vi.fn(() => sim), restart: vi.fn() }
    return sim
  }

  it('heats the simulation and pins the node while dragging, then lets go', () => {
    const sim = simulation()
    const h = createDragHandlers(() => sim)
    const node = { x: 1, y: 2 }
    h.dragStarted({ active: false }, node)
    expect(sim.alphaTarget).toHaveBeenCalledWith(0.3)
    expect(sim.restart).toHaveBeenCalled()
    expect(node).toMatchObject({ fx: 1, fy: 2 })
    h.dragged({ x: 5, y: 6 }, node)
    expect(node).toMatchObject({ fx: 5, fy: 6 })
    h.dragEnded({ active: false }, node)
    expect(sim.alphaTarget).toHaveBeenLastCalledWith(0)
    expect(node).toMatchObject({ fx: null, fy: null })
  })

  it('leaves the simulation alone when another drag is already active', () => {
    const sim = simulation()
    const h = createDragHandlers(() => sim)
    h.dragStarted({ active: true }, {})
    h.dragEnded({ active: true }, {})
    expect(sim.alphaTarget).not.toHaveBeenCalled()
  })
})

describe('drawStarfield', () => {
  const options = { density: 100, sizeRanges: [[1, 2], [2, 3], [3, 4]], opacityRange: [0.5, 1] }
  const fakeCanvas = () => {
    const ctx = { beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), fillStyle: '' }
    return { ctx, canvas: { getContext: () => ctx } }
  }

  it('sizes the canvas and draws one star per `density` px²', () => {
    const { canvas, ctx } = fakeCanvas()
    drawStarfield(canvas, 100, 50, options)
    expect(canvas.width).toBe(100)
    expect(canvas.height).toBe(50)
    expect(ctx.arc).toHaveBeenCalledTimes(50)
    expect(ctx.fillStyle).toMatch(/^hsla\(/)
  })

  it('draws large stars when the odds say so', () => {
    const { canvas, ctx } = fakeCanvas()
    const rand = vi.spyOn(Math, 'random').mockReturnValue(0.99)
    drawStarfield(canvas, 10, 10, { ...options, density: 50 })
    expect(ctx.arc.mock.calls[0][2]).toBeGreaterThanOrEqual(3)
    rand.mockRestore()
  })

  it('does nothing without a canvas', () => {
    expect(() => drawStarfield(null, 1, 1, options)).not.toThrow()
  })
})
