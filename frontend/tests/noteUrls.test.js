import { describe, expect, it, vi } from 'vitest'

vi.mock('@/config/env', () => ({ apiUrl: '' }))

const { encodePath, noteApi, noteIdFromHref, noteRawApi, noteRoute } = await import('@/utils/noteUrls')

describe('note urls', () => {
  it('encodes each segment and keeps the slashes', () => {
    expect(encodePath('Places/La Ciénaga')).toBe('Places/La%20Ci%C3%A9naga')
    expect(noteRoute('C# notes')).toBe('/note/C%23%20notes')
    expect(noteApi('Rules/100% damage')).toBe('/api/note/Rules/100%25%20damage')
    expect(noteRawApi('¿Quién?')).toBe('/api/note-raw/%C2%BFQui%C3%A9n%3F')
  })

  it('reads the note id back from a link, as the backend writes them', () => {
    expect(noteIdFromHref('/note/Places/La%20Ci%C3%A9naga')).toBe('Places/La Ciénaga')
    expect(noteIdFromHref(noteRoute('100% damage') + '#loot')).toBe('100% damage')
    expect(noteIdFromHref('/note/C%23%20notes?new=1')).toBe('C# notes')
  })

  it('keeps a segment that is not valid percent-encoding as written', () => {
    expect(noteIdFromHref('/note/Rules/100%')).toBe('Rules/100%')
  })

  it('ignores links that are not notes', () => {
    expect(noteIdFromHref('https://example.com/note/x')).toBeNull()
    expect(noteIdFromHref('/screen')).toBeNull()
    expect(noteIdFromHref(null)).toBeNull()
  })

  it('round-trips names with anything a file name can hold', () => {
    for (const id of ['¿Quién?', 'C# notes', '100% damage', 'a/b c/d&e', 'Plus+Minus']) {
      expect(noteIdFromHref(noteRoute(id))).toBe(id)
    }
  })
})
