// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick } from 'vue'

vi.mock('@/config/env', () => ({ apiUrl: '' }))

class FakeSocket {
  static instances = []
  readyState = 0
  constructor(url) {
    this.url = url
    FakeSocket.instances.push(this)
  }
  open() {
    this.readyState = 1
    this.onopen?.()
  }
  say(event) {
    this.onmessage?.({ data: JSON.stringify(event) })
  }
  drop(code = 1006) {
    this.readyState = 3
    this.onclose?.({ code })
  }
  close() {
    this.readyState = 3
  }
}

const { useSyncedDoc } = await import('@/composables/useSyncedDoc')
const { syncStatus } = await import('@/composables/syncSocket')

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
  await nextTick()
}

const mounted = []
/** Runs the composable inside a component, like a real caller. */
function use(kind, id, fetchDoc) {
  let result
  const app = createApp(
    defineComponent({
      setup() {
        result = useSyncedDoc(kind, id, fetchDoc)
        return () => h('div')
      }
    })
  )
  app.mount(document.createElement('div'))
  mounted.push(app)
  return { ...result, unmount: () => app.unmount() }
}

const snapshot = (overrides = {}) => ({ id: 'fight', rev: 1, round: 0, combatants: [{ id: 'a', n: 1 }], ...overrides })
const event = (rev, extra = {}) => ({ type: 'doc', doc: 'encounter:fight', rev, ...extra })

beforeEach(() => {
  FakeSocket.instances = []
  vi.stubGlobal('WebSocket', FakeSocket)
})

afterEach(() => {
  mounted.splice(0).forEach((app) => app.unmount())
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useSyncedDoc', () => {
  it('loads the document and applies the changes announced after it', async () => {
    const fetchDoc = vi.fn().mockResolvedValue(snapshot())
    const { doc, status } = use('encounter', 'fight', fetchDoc)
    await flush()
    expect(status.value).toBe('ready')
    expect(doc.value.round).toBe(0)

    const socket = FakeSocket.instances[0]
    expect(socket.url).toMatch(/\/ws\/sync$/)
    socket.open()
    await flush() // opening reloads the document: a change could have been missed meanwhile
    socket.say(event(2, { set: { round: 1 } }))
    expect(doc.value).toMatchObject({ rev: 2, round: 1 })
  })

  it('ignores a change it has already seen, and the other documents\'', async () => {
    const { doc } = use('encounter', 'fight', vi.fn().mockResolvedValue(snapshot()))
    await flush()
    const socket = FakeSocket.instances[0]
    socket.say(event(1, { set: { round: 9 } }))
    socket.say({ ...event(2, { set: { round: 9 } }), doc: 'encounter:another' })
    expect(doc.value.round).toBe(0)
  })

  it('applies the reply of its own command once, however it arrives', async () => {
    const { doc, commit } = use('encounter', 'fight', vi.fn().mockResolvedValue(snapshot()))
    await flush()
    const reply = event(2, { upsert: { combatants: [{ id: 'a', n: 5 }] } })
    await commit(Promise.resolve(reply))
    FakeSocket.instances[0].say(reply)
    expect(doc.value.combatants).toEqual([{ id: 'a', n: 5 }])
    expect(doc.value.rev).toBe(2)
    await commit(Promise.resolve({ type: 'noop' }))
    expect(doc.value.rev).toBe(2)
  })

  it('reloads when it misses a change', async () => {
    const fetchDoc = vi.fn().mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(snapshot({ rev: 5, round: 4 }))
    const { doc } = use('encounter', 'fight', fetchDoc)
    await flush()
    FakeSocket.instances[0].say(event(4, { set: { round: 3 } })) // 2 and 3 never came
    await flush()
    expect(fetchDoc).toHaveBeenCalledTimes(2)
    expect(doc.value).toMatchObject({ rev: 5, round: 4 })
  })

  it('keeps the changes that arrive while it is still loading', async () => {
    let finish
    const fetchDoc = vi.fn(() => new Promise((resolve) => { finish = resolve }))
    const { doc, status } = use('encounter', 'fight', fetchDoc)
    const socket = FakeSocket.instances[0]
    socket.say(event(2, { set: { round: 1 } }))
    socket.say(event(1, { set: { round: 7 } })) // older than the snapshot: dropped
    expect(status.value).toBe('loading')
    finish(snapshot())
    await flush()
    expect(doc.value).toMatchObject({ rev: 2, round: 1 })
  })

  it('reloads on a reset, and when the connection comes back', async () => {
    const fetchDoc = vi.fn().mockResolvedValue(snapshot())
    use('encounter', 'fight', fetchDoc)
    await flush()
    const socket = FakeSocket.instances[0]
    socket.say({ type: 'doc', doc: 'encounter:fight', reset: true })
    await flush()
    expect(fetchDoc).toHaveBeenCalledTimes(2)
    socket.open()
    await flush()
    expect(fetchDoc).toHaveBeenCalledTimes(3)
  })

  it('knows when its document is gone', async () => {
    const { status } = use('encounter', 'fight', vi.fn().mockResolvedValue(snapshot()))
    await flush()
    FakeSocket.instances[0].say({ type: 'gone', doc: 'encounter:fight' })
    expect(status.value).toBe('gone')

    const missing = use('encounter', 'missing', vi.fn().mockRejectedValue({ response: { status: 404 } }))
    await flush()
    expect(missing.status.value).toBe('gone')
    const broken = use('encounter', 'broken', vi.fn().mockRejectedValue(new Error('network')))
    await flush()
    expect(broken.status.value).toBe('error')
    expect(broken.error.value).toBe('network')
  })

  it('shares one copy, and one socket, between everyone who asks', async () => {
    const fetchDoc = vi.fn().mockResolvedValue(snapshot())
    const one = use('encounter', 'fight', fetchDoc)
    const two = use('encounter', 'fight', fetchDoc)
    await flush()
    expect(one.doc).toBe(two.doc)
    expect(fetchDoc).toHaveBeenCalledTimes(1)
    expect(FakeSocket.instances).toHaveLength(1)
  })

  it('lets go of the socket when the last one is done', async () => {
    const one = use('encounter', 'fight', vi.fn().mockResolvedValue(snapshot()))
    const two = use('characters', 'all', vi.fn().mockResolvedValue({ id: 'all', rev: 0, characters: [] }))
    await flush()
    FakeSocket.instances[0].open()
    expect(syncStatus.value).toBe('open')
    one.unmount()
    expect(syncStatus.value).toBe('open')
    two.unmount()
    expect(syncStatus.value).toBe('idle')
  })

  it('reconnects with a growing pause, and gives up when not signed in', async () => {
    vi.useFakeTimers()
    use('encounter', 'fight', vi.fn().mockResolvedValue(snapshot()))
    await flush()
    FakeSocket.instances[0].drop()
    expect(syncStatus.value).toBe('connecting')
    vi.advanceTimersByTime(1000)
    expect(FakeSocket.instances).toHaveLength(2)
    FakeSocket.instances[1].drop()
    vi.advanceTimersByTime(1000)
    expect(FakeSocket.instances).toHaveLength(2) // the pause doubled
    vi.advanceTimersByTime(1000)
    expect(FakeSocket.instances).toHaveLength(3)
    FakeSocket.instances[2].drop(1008)
    expect(syncStatus.value).toBe('denied')
    vi.advanceTimersByTime(60000)
    expect(FakeSocket.instances).toHaveLength(3)
  })
})
