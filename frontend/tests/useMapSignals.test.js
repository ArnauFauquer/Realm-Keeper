// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'

const { post, sync } = vi.hoisted(() => ({ post: vi.fn(), sync: { onEvent: null, stopped: 0 } }))
vi.mock('@/api/http', () => ({ httpClient: { post } }))
vi.mock('@/api/docs', () => ({ battlemapsApi: { base: '/api/battlemaps' } }))
vi.mock('@/composables/useAuth', () => ({ useAuth: () => ({ user: ref({ name: 'Mia', diceSlot: 3 }) }) }))
vi.mock('@/composables/syncSocket', () => ({
  listenToSync: ({ onEvent }) => {
    sync.onEvent = onEvent
    return () => { sync.stopped++ }
  }
}))

const { thin, useMapSignals } = await import('@/composables/useMapSignals')

let signals
let wrapper
const mountWith = (options) => {
  wrapper = mount(defineComponent({
    setup() {
      signals = useMapSignals('caves/deep', options)
      return () => h('div')
    }
  }))
}

beforeEach(() => {
  vi.useFakeTimers()
  post.mockReset().mockResolvedValue({})
  sync.stopped = 0
})
afterEach(() => {
  wrapper?.unmount()
  vi.useRealTimers()
})

const sent = () => post.mock.calls.map(([url, body]) => ({ url, ...body }))

describe('useMapSignals', () => {
  it('pings: drawn at once, sent to everyone with the tab it came from', async () => {
    mountWith()
    signals.ping({ x: 2, y: 3 })
    expect(signals.layer.view().pings[0]).toMatchObject({ x: 2, y: 3, by: null })
    await flushPromises()
    expect(sent()).toEqual([{ url: '/api/battlemaps/caves/deep/signal', kind: 'ping', points: [{ x: 2, y: 3 }], source: expect.any(String) }])
  })

  it('takes everyone else\'s signals on this map, not its own nor other maps\'', () => {
    mountWith()
    signals.ping({ x: 0, y: 0 })
    const own = sent()[0].source
    const ping = (extra) => ({ type: 'signal', battlemap: 'caves/deep', kind: 'ping', points: [{ x: 5, y: 5 }], by: 'Leo', ...extra })
    sync.onEvent(ping({ source: own }))
    sync.onEvent(ping({ battlemap: 'elsewhere', source: 'x' }))
    sync.onEvent({ type: 'doc', doc: 'battlemap:caves/deep', rev: 2 })
    sync.onEvent(ping({ source: 'x' }))
    expect(signals.layer.view().pings.map((p) => p.by)).toEqual([null, 'Leo'])
  })

  it('sends the pointer a few points at a time, one request after another, and its end', async () => {
    let finish
    post.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    mountWith()
    signals.point({ x: 0, y: 0 })
    signals.point({ x: 1, y: 0 })
    await vi.advanceTimersByTimeAsync(50)
    expect(post).toHaveBeenCalledTimes(1)
    signals.point({ x: 2, y: 0 })
    signals.release()
    await vi.advanceTimersByTimeAsync(200)
    expect(post).toHaveBeenCalledTimes(1) // the first is still on its way
    finish({})
    await vi.advanceTimersByTimeAsync(50)
    finish({})
    await vi.advanceTimersByTimeAsync(200)
    const [first, second] = sent()
    expect(post).toHaveBeenCalledTimes(2)
    expect(first).toMatchObject({ kind: 'pointer', end: false, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }] })
    expect(second).toMatchObject({ kind: 'pointer', stroke: first.stroke, end: true, points: [{ x: 2, y: 0 }] })
    expect(second.points[0].t).toBeGreaterThanOrEqual(0)

    signals.point({ x: 7, y: 7 }) // a new stroke
    await vi.advanceTimersByTimeAsync(50)
    expect(sent()[2].stroke).not.toBe(first.stroke)
  })

  it('shares a measurement whole, only the newest, and its end; this tab draws its own', async () => {
    let finish
    post.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    mountWith()
    const path = (n) => Array.from({ length: n }, (_, i) => ({ x: i, y: 0 }))
    signals.measure({ points: path(2), token: 'orc' })
    await vi.advanceTimersByTimeAsync(50)
    signals.measure({ points: path(3), token: 'orc' })
    signals.measure({ points: path(4), token: 'orc', end: true }) // replaces the one before, unsent
    finish({})
    await vi.advanceTimersByTimeAsync(50)
    finish({})
    await vi.advanceTimersByTimeAsync(50)
    const [first, last] = sent()
    expect(post).toHaveBeenCalledTimes(2)
    expect(first).toMatchObject({ kind: 'ruler', token: 'orc', end: false, points: path(2) })
    expect(last).toMatchObject({ kind: 'ruler', stroke: first.stroke, end: true, points: path(4) })
    expect(signals.layer.idle()).toBe(true)

    signals.measure({ points: path(2) }) // a new one
    await vi.advanceTimersByTimeAsync(50)
    expect(sent()[2].stroke).not.toBe(first.stroke)
  })

  it('shows a roll over a token', async () => {
    mountWith()
    signals.roll('orc', { label: 'Bite', formula: '2d6', total: 9 })
    expect(signals.layer.view().rolls[0]).toMatchObject({ token: 'orc', label: 'Bite', total: 9 })
    await flushPromises()
    expect(sent()[0]).toMatchObject({ kind: 'roll', token: 'orc', roll: { label: 'Bite', formula: '2d6', total: 9 } })
  })

  it('sends nothing for someone who may not, and shrugs off a failed send', async () => {
    mountWith({ canSend: () => false })
    signals.ping({ x: 0, y: 0 })
    await flushPromises()
    expect(post).not.toHaveBeenCalled()
    wrapper.unmount()
    post.mockRejectedValue(new Error('offline'))
    mountWith()
    signals.ping({ x: 0, y: 0 })
    await flushPromises()
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('stops listening when it goes away', () => {
    mountWith()
    wrapper.unmount()
    wrapper = null
    expect(sync.stopped).toBe(1)
  })
})

describe('thin', () => {
  it('keeps a batch that fits, and thins one that does not, evenly, keeping the last', () => {
    const points = Array.from({ length: 200 }, (_, i) => ({ x: i, y: 0 }))
    expect(thin(points.slice(0, 10))).toHaveLength(10)
    const thinned = thin(points)
    expect(thinned).toHaveLength(64)
    expect(thinned[0].x).toBe(0)
    expect(thinned[63].x).toBe(199)
  })
})
