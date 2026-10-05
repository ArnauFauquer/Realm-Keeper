import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getCached, put, invalidateCached, notifyNotesChanged } = vi.hoisted(() => ({
  getCached: vi.fn(),
  put: vi.fn(),
  invalidateCached: vi.fn(),
  notifyNotesChanged: vi.fn()
}))
vi.mock('@/api/http', () => ({
  getCached,
  put,
  invalidateCached,
  errorMessage: (err, fallback) => err?.response?.data?.detail || fallback || err?.message
}))
vi.mock('@/config/env', () => ({ apiUrl: '' }))
vi.mock('@/composables/useNotes', () => ({ notifyNotesChanged }))

const { useNoteDraft } = await import('@/composables/useNoteDraft')

const conflict = () => Object.assign(new Error('409'), { response: { status: 409, data: { detail: 'changed' } } })

describe('useNoteDraft', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('is dirty once the draft differs from what it opened with', () => {
    const { draft, dirty } = useNoteDraft(() => 'A', { content: '# A', sha: 's1' })
    expect(dirty.value).toBe(false)
    draft.value = '# A!'
    expect(dirty.value).toBe(true)
  })

  it('saves against the version it loaded, then against the new one', async () => {
    put.mockResolvedValueOnce({ status: 'updated', sha: 's2' }).mockResolvedValueOnce({ status: 'updated', sha: 's3' })
    const { draft, dirty, save } = useNoteDraft(() => 'Places/C# notes', { content: '# A', sha: 's1' })

    draft.value = '# B'
    expect(await save()).toBe(true)
    expect(put).toHaveBeenLastCalledWith('/api/note/Places/C%23%20notes', { content: '# B', base_sha: 's1' })
    expect(dirty.value).toBe(false)
    expect(notifyNotesChanged).toHaveBeenCalled()
    expect(invalidateCached).toHaveBeenCalledWith('/api/note/Places/C%23%20notes')

    draft.value = '# C'
    await save()
    expect(put).toHaveBeenLastCalledWith('/api/note/Places/C%23%20notes', { content: '# C', base_sha: 's2' })
  })

  it('creates a new note only if nobody did meanwhile', async () => {
    put.mockResolvedValue({ status: 'created', sha: 's1' })
    const { save, creating } = useNoteDraft(() => 'New', { content: '# New\n\n', sha: null, creating: true })
    await save()
    expect(put).toHaveBeenCalledWith('/api/note/New', { content: '# New\n\n', base_sha: '' })
    expect(creating.value).toBe(false)
  })

  it('keeps the draft on a conflict, and can overwrite without the check', async () => {
    put.mockRejectedValueOnce(conflict()).mockResolvedValueOnce({ status: 'updated', sha: 's9' })
    const { draft, dirty, conflict: hasConflict, saveError, save } = useNoteDraft(() => 'A', { content: '# A', sha: 's1' })

    draft.value = '# mine'
    expect(await save()).toBe(false)
    expect(hasConflict.value).toBe(true)
    expect(saveError.value).toMatch(/Someone else saved this note/)
    expect(draft.value).toBe('# mine')
    expect(dirty.value).toBe(true)

    expect(await save({ overwrite: true })).toBe(true)
    expect(put).toHaveBeenLastCalledWith('/api/note/A', { content: '# mine' })
    expect(hasConflict.value).toBe(false)
  })

  it('can drop the draft for their version', async () => {
    put.mockRejectedValueOnce(conflict())
    getCached.mockResolvedValueOnce({ content: '# theirs', sha: 's5' })
    put.mockResolvedValueOnce({ status: 'updated', sha: 's6' })
    const { draft, dirty, conflict: hasConflict, save, reloadTheirs } = useNoteDraft(() => 'A', { content: '# A', sha: 's1' })

    draft.value = '# mine'
    await save()
    await reloadTheirs()

    expect(getCached).toHaveBeenCalledWith('/api/note-raw/A', { useCache: false })
    expect(draft.value).toBe('# theirs')
    expect(dirty.value).toBe(false)
    expect(hasConflict.value).toBe(false)

    draft.value = '# theirs, edited'
    await save()
    expect(put).toHaveBeenLastCalledWith('/api/note/A', { content: '# theirs, edited', base_sha: 's5' })
  })

  it('shows any other error as is', async () => {
    put.mockRejectedValueOnce(Object.assign(new Error('x'), { response: { status: 502, data: { detail: 'Push failed' } } }))
    const { save, saveError, conflict: hasConflict } = useNoteDraft(() => 'A', { content: '', sha: null })
    await save()
    expect(saveError.value).toBe('Push failed')
    expect(hasConflict.value).toBe(false)
  })
})
