// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const pairScreen = vi.fn()
vi.mock('@/api/screen', () => ({ pairScreen: (...args) => pairScreen(...args) }))
vi.mock('@/utils/socketUrl', () => ({ socketUrl: (path) => `ws://test${path}` }))

const { useScreenSocket, retryDelay } = await import('@/composables/useScreenSocket')

// A stand-in for the browser's WebSocket: a test opens, feeds and closes it.
class FakeSocket {
  static instances = []
  constructor(url) {
    this.url = url
    this.closed = false
    FakeSocket.instances.push(this)
  }
  close() { this.closed = true }
  open() { this.onopen?.() }
  receive(data) { this.onmessage?.({ data: JSON.stringify(data) }) }
  drop(code = 1006) { this.onclose?.({ code }) }
}

const latest = () => FakeSocket.instances[FakeSocket.instances.length - 1]

let socket

beforeEach(() => {
  FakeSocket.instances = []
  vi.stubGlobal('WebSocket', FakeSocket)
  vi.useFakeTimers()
  // No jitter: each wait is exactly the ceiling.
  vi.spyOn(Math, 'random').mockReturnValue(1)
  pairScreen.mockReset()
  pairScreen.mockResolvedValue({})
  window.history.replaceState(null, '', '/screen')
})

afterEach(() => {
  socket?.stop()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('retryDelay', () => {
  it('doubles from one second, with jitter, up to a cap', () => {
    expect(retryDelay(0, () => 1)).toBe(1000)
    expect(retryDelay(0, () => 0)).toBe(500)
    expect(retryDelay(3, () => 1)).toBe(8000)
    expect(retryDelay(20, () => 1)).toBe(30000)
  })
})

describe('useScreenSocket', () => {
  it('hands each message over, parsed', async () => {
    const onMessage = vi.fn()
    socket = useScreenSocket({ onMessage })
    await socket.start()
    expect(latest().url).toBe('ws://test/ws/screen')
    latest().receive({ type: 'clear_screen' })
    expect(onMessage).toHaveBeenCalledWith({ type: 'clear_screen' })
  })

  it('survives a message it can not read or handle', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const onMessage = vi.fn(() => { throw new Error('boom') })
    socket = useScreenSocket({ onMessage })
    await socket.start()
    latest().onmessage({ data: 'not json' })
    latest().receive({ type: 'clear_screen' })
    expect(onMessage).toHaveBeenCalledTimes(1)
  })

  it('waits longer after each failed reconnection, up to the cap', async () => {
    socket = useScreenSocket()
    await socket.start()
    const waits = []
    for (let i = 0; i < 7; i++) {
      const count = FakeSocket.instances.length
      latest().drop()
      let waited = 0
      while (FakeSocket.instances.length === count) {
        await vi.advanceTimersByTimeAsync(500)
        waited += 500
      }
      waits.push(waited)
    }
    expect(waits).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000])
  })

  it('starts over from a short wait once a connection has held', async () => {
    const onOpen = vi.fn()
    socket = useScreenSocket({ onOpen })
    await socket.start()
    latest().drop()
    await vi.advanceTimersByTimeAsync(1000)
    latest().drop()
    await vi.advanceTimersByTimeAsync(2000)
    latest().open()
    expect(onOpen).toHaveBeenCalledTimes(1)
    const count = FakeSocket.instances.length
    latest().drop()
    await vi.advanceTimersByTimeAsync(1000)
    expect(FakeSocket.instances.length).toBe(count + 1)
  })

  it('flags an unpaired screen and keeps backing off, though the socket opened', async () => {
    socket = useScreenSocket()
    await socket.start()
    latest().open()
    latest().drop(1008)
    expect(socket.notPaired.value).toBe(true)
    await vi.advanceTimersByTimeAsync(1000)
    latest().open()
    expect(socket.notPaired.value).toBe(false)
    latest().drop(1008)
    const count = FakeSocket.instances.length
    await vi.advanceTimersByTimeAsync(1000)
    expect(FakeSocket.instances.length).toBe(count)
    await vi.advanceTimersByTimeAsync(1000)
    expect(FakeSocket.instances.length).toBe(count + 1)
  })

  it('pairs from a screen link and drops the key from the address bar', async () => {
    window.history.replaceState(null, '', '/screen#key=abc')
    socket = useScreenSocket()
    await socket.start()
    expect(pairScreen).toHaveBeenCalledWith('abc')
    expect(window.location.hash).toBe('')
    expect(FakeSocket.instances).toHaveLength(1)
  })

  it('says so when a screen link does not work', async () => {
    pairScreen.mockRejectedValue(new Error('403'))
    window.history.replaceState(null, '', '/screen#key=old')
    socket = useScreenSocket()
    await socket.start()
    expect(socket.pairError.value).toMatch(/invalid or has expired/)
  })

  it('reconnects with the new pairing when a screen link is pasted in', async () => {
    socket = useScreenSocket()
    await socket.start()
    const first = latest()
    // Fires hashchange, as pasting the link does.
    window.location.hash = 'key=new'
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(2))
    expect(pairScreen).toHaveBeenCalledWith('new')
    expect(first.closed).toBe(true)
  })

  it('stops for good: no socket left open, no reconnection', async () => {
    socket = useScreenSocket()
    await socket.start()
    const open = latest()
    open.drop()
    socket.stop()
    await vi.advanceTimersByTimeAsync(60000)
    expect(FakeSocket.instances).toHaveLength(1)
    await socket.start()
    expect(FakeSocket.instances).toHaveLength(1)
  })
})
