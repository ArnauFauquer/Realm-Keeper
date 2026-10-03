import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref, nextTick } from 'vue'

const post = vi.fn()
vi.mock('@/api/http', () => ({ post: (...args) => post(...args) }))
vi.mock('@/config/env', () => ({ apiUrl: '' }))

const { useLiveScreen } = await import('@/composables/useLiveScreen')

const buildPayload = (v) => ({ vista_id: v.id, assets: v.assets })

function setup() {
  const vista = ref({ id: 'night', assets: [{ id: 'a', x: 1 }] })
  return { vista, ...useLiveScreen('vista', vista, buildPayload) }
}

const urls = () => post.mock.calls.map(([url]) => url)

beforeEach(() => {
  vi.useFakeTimers()
  post.mockReset()
  post.mockResolvedValue({ status: 'success' })
})

afterEach(() => vi.useRealTimers())

describe('useLiveScreen', () => {
  it('does not touch the screen while edits are not live', async () => {
    const { vista } = setup()
    vista.value.assets[0].x = 50
    await nextTick()
    await vi.advanceTimersByTimeAsync(500)
    expect(post).not.toHaveBeenCalled()
  })

  it('going live shows the item, then pushes the current edits', async () => {
    const { toggle, live } = setup()
    await toggle()
    await vi.advanceTimersByTimeAsync(200)
    expect(live.value).toBe(true)
    expect(urls()).toEqual(['/api/screen/vista', '/api/screen/vista/live'])
    expect(post.mock.calls[0][1]).toEqual({ vista_id: 'night' })
    expect(post.mock.calls[1][1]).toEqual({ vista_id: 'night', assets: [{ id: 'a', x: 1 }] })
  })

  it('coalesces a burst of edits into one push carrying the latest state', async () => {
    const { toggle, vista } = setup()
    await toggle()
    await vi.advanceTimersByTimeAsync(200)
    post.mockClear()

    for (let x = 10; x <= 50; x += 10) {
      vista.value.assets[0].x = x
      await nextTick()
    }
    await vi.advanceTimersByTimeAsync(200)

    expect(post).toHaveBeenCalledTimes(1)
    expect(post.mock.calls[0][1].assets[0].x).toBe(50)
  })

  it('never has two pushes in flight, and sends what changed meanwhile after', async () => {
    const { toggle, vista } = setup()
    await toggle()
    await vi.advanceTimersByTimeAsync(200)
    post.mockClear()

    let release
    post.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve({ status: 'success' }) }))
    vista.value.assets[0].x = 20
    await nextTick()
    await vi.advanceTimersByTimeAsync(100)
    expect(post).toHaveBeenCalledTimes(1)

    vista.value.assets[0].x = 30
    await nextTick()
    await vi.advanceTimersByTimeAsync(500)
    expect(post).toHaveBeenCalledTimes(1) // still waiting on the first

    release()
    await vi.advanceTimersByTimeAsync(200)
    expect(post).toHaveBeenCalledTimes(2)
    expect(post.mock.calls[1][1].assets[0].x).toBe(30)
  })

  it('stops mirroring when the server says the item is no longer on screen', async () => {
    const { toggle, vista, live } = setup()
    await toggle()
    await vi.advanceTimersByTimeAsync(200)
    post.mockClear()
    post.mockResolvedValueOnce({ status: 'ignored' })

    vista.value.assets[0].x = 70
    await nextTick()
    await vi.advanceTimersByTimeAsync(200)
    expect(live.value).toBe(false)

    post.mockClear()
    vista.value.assets[0].x = 80
    await nextTick()
    await vi.advanceTimersByTimeAsync(500)
    expect(post).not.toHaveBeenCalled()
  })

  it('stopping with unsaved edits puts the saved version back on screen', async () => {
    const { toggle, live } = setup()
    await toggle()
    await vi.advanceTimersByTimeAsync(200)
    post.mockClear()

    await toggle(true)
    expect(live.value).toBe(false)
    expect(urls()).toEqual(['/api/screen/vista'])
  })

  it('stopping with nothing unsaved leaves the screen alone', async () => {
    const { toggle } = setup()
    await toggle()
    await vi.advanceTimersByTimeAsync(200)
    post.mockClear()

    await toggle(false)
    expect(post).not.toHaveBeenCalled()
  })

  it('re-sending to the screen while live keeps showing the unsaved edits', async () => {
    const { toggle, sendToScreen, vista } = setup()
    await toggle()
    await vi.advanceTimersByTimeAsync(200)
    vista.value.assets[0].x = 42
    await nextTick()
    await vi.advanceTimersByTimeAsync(200)
    post.mockClear()

    await sendToScreen()
    await vi.advanceTimersByTimeAsync(200)
    expect(urls()).toEqual(['/api/screen/vista', '/api/screen/vista/live'])
    expect(post.mock.calls[1][1].assets[0].x).toBe(42)
  })
})
