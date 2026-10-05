import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/config/env', () => ({ apiUrl: '' }))

// The real client and the real cache: only the network is stood in for, by
// an axios adapter that answers each request with what `answer` says.
const { httpClient, getCached, invalidateCached } = await import('@/api/http')
const { apiCache } = await import('@/api/cache')
const { useAuth } = await import('@/composables/useAuth')
const { chartsApi } = await import('@/api/docs')
const { observatoryApi } = await import('@/api/observatory')

let answer
const adapter = vi.fn(async (config) => {
  const { status = 200, data } = await answer(config)
  const response = { data, status, statusText: '', headers: {}, config }
  if (status >= 400) {
    const error = new Error(`Request failed with status code ${status}`)
    Object.assign(error, { config, response, isAxiosError: true })
    throw error
  }
  return response
})

beforeEach(() => {
  httpClient.defaults.adapter = adapter
  adapter.mockClear()
  answer = (config) => ({ data: { url: config.url, params: config.params ?? null } })
  apiCache.clear()
})

afterEach(() => vi.useRealTimers())

describe('getCached', () => {
  it('answers the same request from memory', async () => {
    const first = await getCached('/api/tags')
    expect(await getCached('/api/tags')).toBe(first)
    expect(adapter).toHaveBeenCalledTimes(1)
  })

  it('tells requests apart by their query, so page 2 is not page 1', async () => {
    const one = await getCached('/api/notes', { params: { limit: 500, offset: 0 } })
    const two = await getCached('/api/notes', { params: { limit: 500, offset: 500 } })
    expect(one.params.offset).toBe(0)
    expect(two.params.offset).toBe(500)
    expect(adapter).toHaveBeenCalledTimes(2)
    await getCached('/api/notes', { params: { limit: 500, offset: 500 } })
    expect(adapter).toHaveBeenCalledTimes(2)
  })

  it('keeps each answer as long as its caller asked', async () => {
    vi.useFakeTimers()
    await getCached('/api/a', { cacheTtl: 10 })
    await getCached('/api/b', { cacheTtl: 600 })
    vi.advanceTimersByTime(11_000)
    await getCached('/api/a', { cacheTtl: 10 })
    await getCached('/api/b', { cacheTtl: 600 })
    expect(adapter.mock.calls.map(([config]) => config.url)).toEqual(['/api/a', '/api/b', '/api/a'])
  })

  it('always asks the server when told not to use the cache, and keeps nothing', async () => {
    await getCached('/api/sheets', { useCache: false })
    await getCached('/api/sheets', { useCache: false })
    expect(adapter).toHaveBeenCalledTimes(2)
    expect(apiCache.size).toBe(0)
  })

  it('forgets a URL on request: one query, or every query of it', async () => {
    await getCached('/api/notes', { params: { offset: 0 } })
    await getCached('/api/notes', { params: { offset: 500 } })
    await getCached('/api/notes-other')
    invalidateCached('/api/notes', { offset: 0 })
    expect(apiCache.size).toBe(2)
    invalidateCached('/api/notes')
    expect(apiCache.size).toBe(1) // not /api/notes-other
    await getCached('/api/notes', { params: { offset: 500 } })
    expect(adapter).toHaveBeenCalledTimes(4)
  })

  it('sends no Cache-Control of its own (it would only force a CORS preflight)', async () => {
    await getCached('/api/tags')
    expect(adapter.mock.calls[0][0].headers['Cache-Control']).toBeUndefined()
  })
})

describe('the cache', () => {
  it('drops what has expired when something new is stored', () => {
    vi.useFakeTimers()
    apiCache.set('old', 1, 5)
    apiCache.set('kept', 2, 60)
    vi.advanceTimersByTime(6_000)
    apiCache.set('new', 3)
    expect(apiCache.size).toBe(2)
    expect(apiCache.get('old')).toBeNull()
    expect(apiCache.get('kept')).toBe(2)
  })

  it('keeps an entry for its default time when not told otherwise', () => {
    vi.useFakeTimers()
    apiCache.set('x', 1)
    vi.advanceTimersByTime(299_000)
    expect(apiCache.get('x')).toBe(1)
    vi.advanceTimersByTime(2_000)
    expect(apiCache.get('x')).toBeNull()
  })
})

describe('the one client', () => {
  it('signs the page out on a 401 from any api module', async () => {
    const { user } = useAuth()
    answer = () => ({ status: 401 })
    for (const call of [() => chartsApi.fetch('tavern'), () => observatoryApi.list('')]) {
      user.value = { email: 'gm@example.com' }
      await expect(call()).rejects.toThrow('401')
      expect(user.value).toBeNull()
    }
  })

  it('sends the session cookie, with a time limit, except for an upload', async () => {
    answer = () => ({ data: { items: [], skipped: [] } })
    await chartsApi.fetch('tavern')
    expect(adapter.mock.calls[0][0]).toMatchObject({ withCredentials: true, timeout: 30000 })
    await observatoryApi.importFiles('', [new Blob(['x'])])
    expect(adapter.mock.calls[1][0].timeout).toBe(0)
  })
})
