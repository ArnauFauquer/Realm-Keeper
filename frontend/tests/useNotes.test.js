import { describe, it, expect, vi, beforeEach } from 'vitest'

const getCached = vi.fn()
const invalidateCached = vi.fn()
vi.mock('@/api/http', () => ({
  getCached: (...args) => getCached(...args),
  invalidateCached: (...args) => invalidateCached(...args)
}))
vi.mock('@/config/env', () => ({ apiUrl: '' }))

const { useNotes, notifyNotesChanged, useNotesChanged } = await import('@/composables/useNotes')
const { useGraphData } = await import('@/composables/useGraphData')

const page = (start, count) => Array.from({ length: count }, (_, i) => ({ id: `n${start + i}`, title: `N${start + i}` }))
const deferred = () => {
  let resolve
  const promise = new Promise((r) => { resolve = r })
  return { promise, resolve }
}

describe('useNotes', () => {
  beforeEach(() => {
    getCached.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('exposes the error when loading fails', async () => {
    getCached.mockRejectedValueOnce(new Error('Request failed with status code 500'))
    const { fetchNotes, error, notes, loading } = useNotes()

    await fetchNotes()

    expect(error.value).toBe('Request failed with status code 500')
    expect(notes.value).toEqual([])
    expect(loading.value).toBe(false)
  })

  it('clears the error and loads notes on retry', async () => {
    getCached
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce([{ id: 'Hero', title: 'Hero' }])
    const { fetchNotes, error, notes } = useNotes()

    await fetchNotes()
    expect(error.value).toBe('offline')

    await fetchNotes()
    expect(error.value).toBe(null)
    expect(notes.value).toEqual([{ id: 'Hero', title: 'Hero' }])
  })

  it('does not send a search term when retried without one', async () => {
    getCached.mockResolvedValue([])
    const { fetchNotes } = useNotes()

    await fetchNotes()

    const [, options] = getCached.mock.calls[0]
    expect(options.params.search).toBeUndefined()
    expect(options.useCache).toBe(true)
  })

  it('loads page after page', async () => {
    getCached.mockResolvedValueOnce(page(0, 500)).mockResolvedValueOnce(page(500, 3))
    const { fetchNotes, loadMoreNotes, notes, hasMore } = useNotes()

    await fetchNotes()
    await loadMoreNotes()

    expect(notes.value).toHaveLength(503)
    expect(hasMore.value).toBe(false)
    expect(getCached.mock.calls[1][1]).toMatchObject({ params: { offset: 500 } })
  })

  it('a retry is not dropped while a page is loading, and the late page is ignored', async () => {
    const slow = deferred()
    getCached
      .mockResolvedValueOnce(page(0, 500))
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValueOnce([{ id: 'fresh', title: 'Fresh' }])
    const { fetchNotes, loadMoreNotes, notes, isLoadingMore } = useNotes()

    await fetchNotes()
    const pending = loadMoreNotes()
    expect(isLoadingMore.value).toBe(true)

    await fetchNotes()
    expect(notes.value).toEqual([{ id: 'fresh', title: 'Fresh' }])

    slow.resolve(page(500, 10))
    await pending
    expect(notes.value).toEqual([{ id: 'fresh', title: 'Fresh' }])
    expect(isLoadingMore.value).toBe(false)
  })

  it('a refresh keeps the list on screen until the new one arrives', async () => {
    const slow = deferred()
    getCached.mockResolvedValueOnce([{ id: 'old', title: 'Old' }]).mockReturnValueOnce(slow.promise)
    const { fetchNotes, refreshNotes, notes } = useNotes()

    await fetchNotes()
    const refreshing = refreshNotes()
    expect(notes.value).toEqual([{ id: 'old', title: 'Old' }])

    slow.resolve([{ id: 'old', title: 'Old' }, { id: 'new', title: 'New' }])
    await refreshing
    expect(notes.value.map((n) => n.id)).toEqual(['old', 'new'])
  })

  it('notifyNotesChanged drops the cached lists and bumps the signal and the graph', () => {
    const changed = useNotesChanged()
    const { version } = useGraphData()
    const before = [changed.value, version.value]

    notifyNotesChanged()

    expect(invalidateCached).toHaveBeenCalledWith('/api/notes')
    expect(invalidateCached).toHaveBeenCalledWith('/api/tags')
    expect(invalidateCached).toHaveBeenCalledWith('/api/container-folders')
    expect([changed.value, version.value]).toEqual([before[0] + 1, before[1] + 1])
  })
})
