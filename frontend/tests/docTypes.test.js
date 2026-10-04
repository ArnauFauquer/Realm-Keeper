import { describe, expect, it } from 'vitest'
import { DOC_TYPES, EMBEDDABLE_TYPES, embedIcon, savePayload, screenPayload } from '@/utils/docTypes'
import { docRefMarkdown, parseDocRef, parseInlineRef, renderInlineRef } from '@/utils/inlineRefs'

const chart = {
  id: 'regions/tavern', name: 'Tavern', description: 'Where it starts', image_url: '/api/asset-library/assets/m.png',
  pins: [{ id: 'p' }], paths: [], annotations: [], updated_at: 'then', extra: 'not edited here'
}
const vista = {
  id: 'night', name: 'Night', description: null, background_url: '/api/asset-library/assets/b.png',
  vanishing_point: { x: 1, y: 2 }, background_offset_y: 30, assets: [{ id: 'a' }], updated_at: 'then'
}

describe('what a save and a screen are sent', () => {
  it("saves a chart's name, description and the fields it edits, and nothing it keeps elsewhere", () => {
    expect(savePayload(DOC_TYPES.chart, chart)).toEqual({
      name: 'Tavern', description: 'Where it starts', pins: [{ id: 'p' }], paths: [], annotations: []
    })
  })

  it("saves a vista's own fields", () => {
    expect(savePayload(DOC_TYPES.vista, vista)).toEqual({
      name: 'Night', description: null, vanishing_point: { x: 1, y: 2 }, background_offset_y: 30, assets: [{ id: 'a' }]
    })
  })

  it('shows a chart on the screen by its id, its picture and what is edited', () => {
    expect(screenPayload(DOC_TYPES.chart, chart)).toEqual({
      chart_id: 'regions/tavern', image_url: '/api/asset-library/assets/m.png', pins: [{ id: 'p' }], paths: [], annotations: []
    })
  })

  it("shows a vista with its background, whose field is not the chart's", () => {
    expect(screenPayload(DOC_TYPES.vista, vista)).toEqual({
      vista_id: 'night', background_url: '/api/asset-library/assets/b.png',
      vanishing_point: { x: 1, y: 2 }, background_offset_y: 30, assets: [{ id: 'a' }]
    })
  })
})

describe('the kinds', () => {
  it('has one entry for each, under the key it is looked up by', () => {
    expect(Object.keys(DOC_TYPES)).toEqual(['chart', 'vista', 'encounter', 'character', 'adversary', 'battlemap'])
    for (const [key, docType] of Object.entries(DOC_TYPES)) expect(docType.type).toBe(key)
  })

  it('names the resource each lives under: what the backend serves', () => {
    expect(Object.values(DOC_TYPES).map((t) => t.resource)).toEqual(['charts', 'vistas', 'encounters', 'characters', 'adversaries', 'battlemaps'])
  })

  it('has the screen and a picture only for the ones that can be shown', () => {
    for (const docType of Object.values(DOC_TYPES).filter((t) => t.screen)) {
      expect(docType.imageField).toBeTruthy()
      expect(docType.assetRoute).toBeTruthy()
      expect(docType.saved.length).toBeGreaterThan(0)
    }
    expect(DOC_TYPES.encounter.screen).toBeUndefined()
  })
})

describe('what a note can embed', () => {
  it('is what the kinds say', () => {
    expect(EMBEDDABLE_TYPES).toEqual(['chart', 'vista', 'character', 'adversary'])
  })

  it('reads `chart:` and `vista:` references, with folders and spaces in the id', () => {
    expect(parseDocRef('chart:regions/tavern-map')).toEqual({ type: 'chart', id: 'regions/tavern-map' })
    expect(parseDocRef('Vista:La Biblioteca/la-entrada')).toEqual({ type: 'vista', id: 'La Biblioteca/la-entrada' })
    expect(parseDocRef('encounter:fight')).toBeNull() // not embeddable (yet)
    expect(parseDocRef('chart:')).toBeNull()
    expect(parseInlineRef('chart:maps/town')).toEqual({ kind: 'doc', type: 'chart', id: 'maps/town' })
  })

  it('draws a placeholder with the kind\'s embed icon', () => {
    const escape = (text) => text
    expect(renderInlineRef({ kind: 'doc', type: 'vista', id: 'night' }, escape)).toContain('mdi-image-filter-hdr')
    expect(renderInlineRef({ kind: 'doc', type: 'chart', id: 'a' }, escape)).toContain(`mdi ${embedIcon('chart')}`)
    expect(docRefMarkdown('chart', 'a/b')).toBe('`chart:a/b`')
  })
})
