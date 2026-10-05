import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// public/sw.js, run as the browser would run it, over a Cache Storage and a
// network made of Maps: what each build's pages and files leave behind.
const SOURCE = readFileSync(fileURLToPath(new URL('../public/sw.js', import.meta.url)), 'utf8')
const ORIGIN = 'https://rk.test'

class FakeCache {
  entries = new Map()
  key = (request) => new URL(typeof request === 'string' ? request : request.url, ORIGIN).href
  async match(request) { return this.entries.get(this.key(request))?.clone() }
  async put(request, response) { this.entries.set(this.key(request), response) }
  async delete(request) { return this.entries.delete(this.key(request)) }
  async keys() { return [...this.entries.keys()].map((url) => ({ url })) }
  async addAll(urls) { for (const url of urls) this.entries.set(this.key(url), new Response('cached')) }
}

let stores
let network
let listeners

const caches = {
  open: async (name) => {
    if (!stores.has(name)) stores.set(name, new FakeCache())
    return stores.get(name)
  },
  keys: async () => [...stores.keys()],
  delete: async (name) => stores.delete(name),
  match: async (request) => {
    for (const cache of stores.values()) {
      const found = await cache.match(request)
      if (found) return found
    }
    return undefined
  }
}

const fetch = async (request) => {
  const answer = network.get(new URL(request.url, ORIGIN).pathname)
  if (!answer) throw new TypeError('offline')
  return new Response(answer.body, { status: 200, headers: answer.headers || {} })
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

async function get(path, mode = 'no-cors') {
  let response
  const event = {
    request: { url: ORIGIN + path, method: 'GET', mode },
    respondWith: (promise) => { response = promise },
    waitUntil: () => {}
  }
  listeners.fetch(event)
  const result = await response
  await settle()
  return result
}

const page = (build) => `<!doctype html><script type="module" src="/assets/index-${build}.js"></script>`
const deploy = (build, chunks = []) => {
  network.set('/', { body: page(build) })
  network.set(`/assets/index-${build}.js`, { body: `build ${build}` })
  for (const chunk of chunks) network.set(`/assets/${chunk}.js`, { body: chunk })
}
const cachedFiles = (build) => [...(stores.get(`realm-keeper-build-${build}`)?.entries.keys() || [])].map((url) => new URL(url).pathname)

beforeEach(() => {
  stores = new Map()
  network = new Map()
  listeners = {}
  const self = { addEventListener: (type, fn) => { listeners[type] = fn }, skipWaiting: () => {} }
  new Function('self', 'caches', 'fetch', SOURCE)(self, caches, fetch)
})

describe('the service worker', () => {
  it("keeps each build's files apart, and only the current build and the one before", async () => {
    deploy('aaa', ['ChartCanvas-aaa'])
    await get('/', 'navigate')
    await get('/assets/index-aaa.js')
    await get('/assets/ChartCanvas-aaa.js')
    expect(cachedFiles('aaa')).toEqual(['/assets/index-aaa.js', '/assets/ChartCanvas-aaa.js'])

    deploy('bbb')
    await get('/', 'navigate')
    await get('/assets/index-bbb.js')
    expect(cachedFiles('bbb')).toEqual(['/assets/index-bbb.js'])
    expect(cachedFiles('aaa')).toHaveLength(2) // a tab still on it may need its chunks

    deploy('ccc')
    await get('/', 'navigate')
    expect(stores.has('realm-keeper-build-aaa')).toBe(false)
    expect(stores.has('realm-keeper-build-bbb')).toBe(true)
  })

  it('serves a file of the build from its cache when the network is gone', async () => {
    deploy('aaa')
    await get('/', 'navigate')
    await get('/assets/index-aaa.js')
    network.clear()
    expect(await (await get('/assets/index-aaa.js')).text()).toBe('build aaa')
  })

  it('drops older caches when it takes over, but not the builds it keeps', async () => {
    deploy('aaa')
    await get('/', 'navigate')
    await get('/assets/index-aaa.js')
    await caches.open('realm-keeper-v2')
    let activated
    listeners.activate({ waitUntil: (promise) => { activated = promise } })
    await activated
    expect([...stores.keys()].sort()).toEqual(['realm-keeper-build-aaa', 'realm-keeper-meta', 'realm-keeper-v3'])
  })

  it('still never keeps an API response marked private', async () => {
    network.set('/api/auth/me', { body: '{"email":"gm@example.com"}', headers: { 'Cache-Control': 'private, no-store' } })
    network.set('/api/notes', { body: '[]', headers: { 'Cache-Control': 'max-age=60' } })
    await get('/api/auth/me')
    await get('/api/notes')
    const kept = [...stores.get('realm-keeper-v3').entries.keys()].map((url) => new URL(url).pathname)
    expect(kept).toEqual(['/api/notes'])
  })
})
