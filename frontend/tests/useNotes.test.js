import { describe, it, expect, vi, beforeEach } from 'vitest'

const getCached = vi.fn()
vi.mock('@/api/http', () => ({ getCached: (...args) => getCached(...args) }))
vi.mock('@/config/env', () => ({ apiUrl: '' }))

const { useNotes } = await import('@/composables/useNotes')

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
})
