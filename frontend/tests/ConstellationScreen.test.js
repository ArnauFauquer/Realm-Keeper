// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

const getCached = vi.fn()
vi.mock('@/api/http', () => ({ getCached: (...args) => getCached(...args) }))
vi.mock('@/config/env', () => ({ apiUrl: '' }))

const ConstellationScreen = (await import('@/components/ConstellationScreen.vue')).default

const GRAPH = {
  nodes: [
    { id: 'a', title: 'Alpha', type: 'npc' },
    { id: 'b', title: 'Beta', type: 'npc' },
    { id: 'late', title: 'Added after the GM loaded', type: 'npc' }
  ],
  links: [{ source: 'a', target: 'b' }, { source: 'a', target: 'late' }]
}

const state = (overrides = {}) => ({
  view: { x: 0, y: 0, k: 1, width: 1920, height: 1080 },
  positions: { a: [100, 100], b: [300, 200] },
  highlighted_type: null,
  hover_id: null,
  ...overrides
})

let ctx
let wrapper

const nextFrames = (count = 3) => new Promise(resolve => {
  let left = count
  const step = () => (--left <= 0 ? resolve() : setTimeout(step, 5))
  setTimeout(step, 5)
})

const labelsDrawn = () => ctx.fillText.mock.calls.map(([text]) => text)

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', cb => setTimeout(() => cb(performance.now()), 0))
  vi.stubGlobal('cancelAnimationFrame', id => clearTimeout(id))
  ctx = new Proxy({}, {
    get: (target, prop) => { if (!(prop in target)) target[prop] = vi.fn(); return target[prop] },
    set: (target, prop, value) => { target[prop] = value; return true }
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx)
  vi.spyOn(HTMLCanvasElement.prototype, 'clientWidth', 'get').mockReturnValue(1920)
  vi.spyOn(HTMLCanvasElement.prototype, 'clientHeight', 'get').mockReturnValue(1080)
  getCached.mockReset()
  getCached.mockResolvedValue(GRAPH)
})

afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('ConstellationScreen', () => {
  it('fetches the public graph and draws it where the GM has the notes', async () => {
    wrapper = mount(ConstellationScreen, { props: { state: state() } })
    await flushPromises()
    await nextFrames()

    expect(getCached).toHaveBeenCalledWith('/api/graph/all', { useCache: false })
    expect(wrapper.find('.constellation-error').exists()).toBe(false)
    // Notes the GM's layout doesn't know about are not drawn.
    expect(labelsDrawn()).toEqual(expect.arrayContaining(['Alpha', 'Beta']))
    expect(labelsDrawn()).not.toContain('Added after the GM loaded')
    // Same-size screen, k = 1: nodes land at the GM's coordinates.
    const centres = ctx.arc.mock.calls.map(([x, y]) => [x, y])
    expect(centres).toEqual(expect.arrayContaining([[100, 100], [300, 200]]))
  })

  it('follows live updates: nodes move and highlights change', async () => {
    wrapper = mount(ConstellationScreen, { props: { state: state() } })
    await flushPromises()
    await nextFrames()

    ctx.arc.mockClear()
    await wrapper.setProps({ state: state({ positions: { a: [150, 160], b: [300, 200] }, hover_id: 'a' }) })
    await nextFrames()
    const centres = ctx.arc.mock.calls.map(([x, y]) => [x, y])
    expect(centres).toEqual(expect.arrayContaining([[150, 160]]))
    expect(centres).not.toEqual(expect.arrayContaining([[100, 100]]))
  })

  it('eases towards a new view instead of jumping', async () => {
    wrapper = mount(ConstellationScreen, { props: { state: state() } })
    await flushPromises()
    await nextFrames()

    ctx.setTransform.mockClear()
    await wrapper.setProps({ state: state({ view: { x: -400, y: 0, k: 2, width: 1920, height: 1080 } }) })
    await nextFrames(40)
    const scales = ctx.setTransform.mock.calls.map(args => args[0]).filter(scale => scale > 0)
    expect(scales.length).toBeGreaterThan(2)
    expect(scales[0]).toBeLessThan(2) // started below the target…
    expect(scales[scales.length - 1]).toBeCloseTo(2, 1) // …and settled on it
  })

  it('shows a message when the graph cannot be loaded', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    getCached.mockRejectedValue(new Error('boom'))
    wrapper = mount(ConstellationScreen, { props: { state: state() } })
    await flushPromises()
    expect(wrapper.find('.constellation-error').exists()).toBe(true)
  })

  it('stops drawing after it is unmounted', async () => {
    wrapper = mount(ConstellationScreen, { props: { state: state() } })
    await flushPromises()
    await nextFrames()
    wrapper.unmount()
    wrapper = null
    ctx.clearRect.mockClear()
    await nextFrames(10)
    expect(ctx.clearRect).not.toHaveBeenCalled()
  })
})
