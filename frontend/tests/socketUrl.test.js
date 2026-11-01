// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

// Where the page is, as socketUrl reads it.
function pageAt(href) {
  const url = new URL(href)
  Object.defineProperty(window, 'location', {
    value: { protocol: url.protocol, host: url.host, hostname: url.hostname },
    configurable: true
  })
}

async function socketUrlFor(apiUrl, path) {
  vi.resetModules()
  vi.doMock('@/config/env', () => ({ apiUrl }))
  return (await import('@/utils/socketUrl')).socketUrl(path)
}

afterEach(() => vi.resetModules())

describe('socketUrl', () => {
  it("is the page's own host when the app talks to the API through its own web server", async () => {
    pageAt('https://realmkeeper.example.com/screen')
    expect(await socketUrlFor('', '/ws/screen')).toBe('wss://realmkeeper.example.com/ws/screen')
    pageAt('http://localhost:5173/')
    expect(await socketUrlFor('', '/ws/sync')).toBe('ws://localhost:5173/ws/sync')
  })

  it("is the API's host when the app is built to talk to one directly", async () => {
    pageAt('https://app.example.com/')
    expect(await socketUrlFor('https://api.example.com', '/ws/sync')).toBe('wss://api.example.com/ws/sync')
  })

  it('reaches a localhost API through the LAN address the page was opened on', async () => {
    pageAt('http://192.168.1.49:5173/')
    expect(await socketUrlFor('http://localhost:8000', '/ws/screen')).toBe('ws://192.168.1.49:8000/ws/screen')
    pageAt('http://localhost:5173/')
    expect(await socketUrlFor('http://localhost:8000', '/ws/screen')).toBe('ws://localhost:8000/ws/screen')
  })
})
