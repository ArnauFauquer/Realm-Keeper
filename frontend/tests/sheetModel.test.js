import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { SHEET_TEMPLATES, sheetFromDoc } from '@/utils/sheet'
import {
  bodyFromModel,
  modelFromBody,
  newCounter,
  newItem,
  newSection,
  newStatGroup,
  normalizeBody,
  sameSheet,
  statInput
} from '@/utils/sheetModel'

const FIXTURES = fileURLToPath(new URL('../../backend/tests/fixtures/sheet-bodies/', import.meta.url))
const fixtures = readdirSync(FIXTURES).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(FIXTURES + f, 'utf-8')))
const drawn = (body, type = 'adversary') => sheetFromDoc({ id: 'x', name: 'X', sheet: body }, type).sheet

describe('sheet builder model', () => {
  it.each(fixtures.map((f) => [f.doc.id, f]))('%s draws the same after going through the builder', (_id, { type, doc }) => {
    expect(drawn(bodyFromModel(modelFromBody(doc.sheet)), type)).toEqual(drawn(doc.sheet, type))
  })

  it.each(Object.keys(SHEET_TEMPLATES))('the %s template draws the same after going through the builder', (type) => {
    expect(drawn(normalizeBody(SHEET_TEMPLATES[type]), type)).toEqual(drawn(SHEET_TEMPLATES[type], type))
  })

  it('saves every field, as the server stores it', () => {
    expect(normalizeBody({})).toEqual({ subtitle: null, image: null, tags: [], columns: null, text: null, sections: [] })
    const [section] = normalizeBody({ sections: [{ counters: [{ name: 'HP', max: 6 }] }] }).sections
    expect(section).toEqual({
      title: null, columns: null, wide: false, collapsed: false, tab: null,
      counters: [{ name: 'HP', max: 6, min: 0, start: null, color: null, style: null }],
      stats: [],
      items: []
    })
  })

  it('leaves rows out until they are named, and trims what is typed', () => {
    const model = modelFromBody({})
    const section = newSection('  Actions ')
    section.counters.push(newCounter())
    section.stats.push(newStatGroup())
    section.items.push(newItem())
    model.sections.push(section)
    expect(bodyFromModel(model).sections[0]).toMatchObject({ title: 'Actions', counters: [], stats: [], items: [] })

    section.counters[0].name = 'HP '
    section.stats[0].stats[0] = { label: 'Defense', value: statInput('12'), roll: null }
    section.items[0].name = 'Bite'
    section.items[0].roll = '1d6'
    const sheet = drawn(bodyFromModel(model))
    expect(sheet.resources).toEqual({ HP: { max: 6, min: 0, start: null, color: null, style: null } })
    expect(sheet.sections[0].stats).toEqual([{ title: null, columns: null, stats: [{ label: 'Defense', value: 12, roll: null }] }])
    expect(sheet.sections[0].items[0]).toMatchObject({ name: 'Bite', roll: '1d6' })
  })

  it('keeps a typed value as text unless it is a whole number', () => {
    expect([statInput('12'), statInput('-3'), statInput('+2'), statInput('7 / 13'), statInput('  ')]).toEqual([12, -3, '+2', '7 / 13', ''])
  })

  it('only folds a titled section', () => {
    const body = normalizeBody({ sections: [{ collapsed: true }, { title: 'Gear', collapsed: true }] })
    expect(body.sections.map((s) => s.collapsed)).toEqual([false, true])
  })

  it('tells two sheets apart only by what they save', () => {
    expect(sameSheet({ sections: [] }, { subtitle: '', tags: [], sections: [] })).toBe(true)
    expect(sameSheet({ subtitle: 'Brute' }, {})).toBe(false)
  })
})
