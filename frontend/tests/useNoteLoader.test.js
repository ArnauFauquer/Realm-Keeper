import { beforeEach, describe, expect, it, vi } from 'vitest'

const getCached = vi.fn()
vi.mock('@/api/http', () => ({
  getCached: (...args) => getCached(...args),
  errorMessage: (err, fallback) => err?.response?.data?.detail || fallback || err?.message
}))
vi.mock('@/config/env', () => ({ apiUrl: '' }))

const { useNoteLoader } = await import('@/composables/useNoteLoader')

const deferred = () => {
  let resolve
  let reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
const notFound = () => Object.assign(new Error('404'), { response: { status: 404 } })

describe('useNoteLoader', () => {
  beforeEach(() => getCached.mockReset())

  it('loads a note by its encoded url', async () => {
    getCached.mockResolvedValue({ id: 'C# notes', title: 'C# notes' })
    const { note, loading, load } = useNoteLoader()

    expect(await load('C# notes')).toBe(true)
    expect(getCached).toHaveBeenCalledWith('/api/note/C%23%20notes', { cacheTtl: 300 })
    expect(note.value.title).toBe('C# notes')
    expect(loading.value).toBe(false)
  })

  it('shows the last note asked for, whichever answer arrives last', async () => {
    const a = deferred()
    const b = deferred()
    getCached.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise)
    const { note, loading, load } = useNoteLoader()

    const loadingA = load('A')
    const loadingB = load('B')
    b.resolve({ id: 'B' })
    await loadingB
    a.resolve({ id: 'A' })
    expect(await loadingA).toBe(false)

    expect(note.value.id).toBe('B')
    expect(loading.value).toBe(false)
  })

  it('forgets the previous note as soon as another one is asked for, and on a 404', async () => {
    getCached.mockResolvedValueOnce({ id: 'A' }).mockRejectedValueOnce(notFound())
    const { note, notFound: missing, load } = useNoteLoader()

    await load('A')
    const loadingB = load('B')
    expect(note.value).toBeNull()
    await loadingB
    expect(note.value).toBeNull()
    expect(missing.value).toBe(true)
  })

  it('reports other errors with the server detail', async () => {
    getCached.mockRejectedValueOnce(Object.assign(new Error('boom'), { response: { status: 500, data: { detail: 'Vault offline' } } }))
    const { error, load } = useNoteLoader()
    await load('A')
    expect(error.value).toBe('Vault offline')
  })

  it("doesn't hand the editor a note's file once the view moved to another note", async () => {
    const raw = deferred()
    getCached.mockResolvedValueOnce({ id: 'A' }).mockReturnValueOnce(raw.promise).mockResolvedValueOnce({ id: 'B' })
    const { load, loadRaw } = useNoteLoader()

    await load('A')
    const editing = loadRaw('A')
    await load('B')
    raw.resolve({ content: '# A', sha: 'abc' })

    expect(await editing).toBeNull()
  })

  it('returns the file and its sha for the current note', async () => {
    getCached.mockResolvedValueOnce({ id: 'A' }).mockResolvedValueOnce({ content: '# A', sha: 'abc' })
    const { load, loadRaw } = useNoteLoader()
    await load('A')
    expect(await loadRaw('A')).toEqual({ content: '# A', sha: 'abc' })
    expect(getCached).toHaveBeenLastCalledWith('/api/note-raw/A', { useCache: false })
  })
})
