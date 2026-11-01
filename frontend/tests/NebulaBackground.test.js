// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

let ctx, reduced, mq, raf, cancel

beforeEach(() => {
  vi.resetModules()
  ctx = new Proxy({}, {
    get: (t, k) => (k in t ? t[k] : (t[k] = vi.fn(() => ({ addColorStop: vi.fn() })))),
    set: (t, k, v) => { t[k] = v; return true }
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx)
  reduced = false
  mq = { listeners: [], get matches() { return reduced }, addEventListener(_, f) { this.listeners.push(f) }, removeEventListener() {} }
  vi.stubGlobal('matchMedia', () => mq)
  window.matchMedia = () => mq
  raf = vi.fn(() => 7)
  cancel = vi.fn()
  vi.stubGlobal('requestAnimationFrame', raf)
  vi.stubGlobal('cancelAnimationFrame', cancel)
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); Object.defineProperty(document, 'hidden', { value: false, configurable: true }) })

const load = async () => mount((await import('@/components/NebulaBackground.vue')).default)

describe('NebulaBackground', () => {
  it('sizes the canvas to the window and starts animating', async () => {
    const w = await load()
    const canvas = w.find('canvas').element
    expect(canvas.width).toBe(window.innerWidth)
    expect(canvas.height).toBe(window.innerHeight)
    expect(raf).toHaveBeenCalled()
    w.unmount()
  })

  it('draws a frame, with a sprite per star hue, at most 30 times a second', async () => {
    const w = await load()
    const frame = raf.mock.calls[0][0]
    frame(1000)
    expect(ctx.clearRect).toHaveBeenCalledTimes(1)
    expect(ctx.arc).toHaveBeenCalled()
    expect(ctx.drawImage).toHaveBeenCalled()
    frame(1005)   // too soon
    expect(ctx.clearRect).toHaveBeenCalledTimes(1)
    frame(1100)
    expect(ctx.clearRect).toHaveBeenCalledTimes(2)
    w.unmount()
  })

  it('draws one still frame and no animation with reduced motion', async () => {
    reduced = true
    const w = await load()
    expect(raf).not.toHaveBeenCalled()
    expect(ctx.clearRect).toHaveBeenCalled()
    w.unmount()
  })

  it('stops while the tab is hidden and resumes when it is back', async () => {
    const w = await load()
    Object.defineProperty(document, 'hidden', { value: true, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(cancel).toHaveBeenCalled()
    const calls = raf.mock.calls.length
    Object.defineProperty(document, 'hidden', { value: false, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(raf.mock.calls.length).toBe(calls + 1)
    w.unmount()
  })

  it('rebuilds on resize and follows the motion preference', async () => {
    const w = await load()
    window.innerWidth = 500
    window.dispatchEvent(new Event('resize'))
    expect(w.find('canvas').element.width).toBe(500)
    reduced = true
    mq.listeners.forEach((f) => f())
    expect(cancel).toHaveBeenCalled()
    w.unmount()
  })

  it('lets go of the listeners when it goes away', async () => {
    const off = vi.spyOn(window, 'removeEventListener')
    const w = await load()
    w.unmount()
    expect(off).toHaveBeenCalledWith('resize', expect.any(Function))
  })
})
