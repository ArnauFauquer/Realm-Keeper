import { beforeEach, describe, expect, it, vi } from 'vitest'

const getCached = vi.fn()
vi.mock('@/api/http', () => ({ getCached: (...args) => getCached(...args) }))
vi.mock('@/config/env', () => ({ apiUrl: '' }))

const { fetchGraph, invalidateGraph, isValidGraph } = await import('@/composables/useGraphData')

const GRAPH = { nodes: [{ id: 'a' }], links: [] }

describe('useGraphData', () => {
  beforeEach(() => {
    getCached.mockReset()
    invalidateGraph()
  })

  it('shares one request between its readers', async () => {
    getCached.mockResolvedValue(GRAPH)
    const [first, second] = await Promise.all([fetchGraph(), fetchGraph()])
    expect(first).toBe(second)
    expect(getCached).toHaveBeenCalledTimes(1)
    expect(getCached).toHaveBeenCalledWith('/api/graph/all', { useCache: false })
  })

  it('fetches again once invalidated, or when asked for a fresh copy', async () => {
    getCached.mockResolvedValue(GRAPH)
    await fetchGraph()
    invalidateGraph()
    await fetchGraph()
    await fetchGraph({ fresh: true })
    expect(getCached).toHaveBeenCalledTimes(3)
  })

  it('rejects malformed data and does not keep a failure', async () => {
    getCached.mockResolvedValueOnce({ nodes: [] }).mockResolvedValueOnce(GRAPH)
    await expect(fetchGraph()).rejects.toThrow('Invalid graph data')
    await expect(fetchGraph()).resolves.toBe(GRAPH)
  })

  it('validates the shape', () => {
    expect(isValidGraph(GRAPH)).toBe(true)
    expect(isValidGraph(null)).toBe(false)
    expect(isValidGraph({ nodes: [], links: null })).toBe(false)
  })
})
