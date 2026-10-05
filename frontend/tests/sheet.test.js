import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { normalizeImage, SHEET_TEMPLATES, sheetFromDoc, sheetProblems } from '@/utils/sheet'

// The same files backend/tests/test_sheets.py checks: both sides must draw a
// document's sheet alike, or a sheet would show one thing in a note and
// another in the encounter picker.
const FIXTURES = fileURLToPath(new URL('../../backend/tests/fixtures/sheet-bodies/', import.meta.url))
const cases = readdirSync(FIXTURES).filter((f) => f.endsWith('.json'))
const read = (name) => JSON.parse(readFileSync(FIXTURES + name, 'utf-8'))

describe('sheet fixtures shared with the backend', () => {
  it('finds the cases', () => {
    expect(cases.length).toBeGreaterThan(3)
  })

  it.each(cases)('%s draws like the backend', (file) => {
    const { type, doc, expected } = read(file)
    expect(sheetFromDoc(doc, type)).toEqual(expected)
  })
})

describe('sheetFromDoc', () => {
  it("is named by its document, and empty while it has no sheet", () => {
    const { sheet, warnings } = sheetFromDoc({ id: 'imp', name: 'Imp' }, 'adversary')
    expect([sheet.id, sheet.name, sheet.type, sheet.sections, warnings]).toEqual(['imp', 'Imp', 'adversary', [], []])
  })

  it.each(Object.keys(SHEET_TEMPLATES))('the %s template is a sheet with counters', (type) => {
    const { sheet, warnings } = sheetFromDoc({ id: 'new', name: 'New', sheet: SHEET_TEMPLATES[type] }, type)
    expect(warnings).toEqual([])
    expect(Object.keys(sheet.resources)).toEqual(['HP', 'Stress'])
    expect(sheetProblems(SHEET_TEMPLATES[type])).toEqual([])
  })
})

describe('sheetProblems', () => {
  it('names counters that share a name or a minimum above the maximum', () => {
    const body = {
      sections: [
        { counters: [{ name: 'HP', max: 6, min: 0 }] },
        { counters: [{ name: 'HP', max: 3, min: 0 }, { name: 'Fear', max: 1, min: 2 }] }
      ]
    }
    expect(sheetProblems(body)).toEqual([
      'Two counters are called "HP": each one needs its own name.',
      '"Fear" has a minimum above its maximum.'
    ])
  })

  it('caps the counters a sheet can have', () => {
    const counters = Array.from({ length: 25 }, (_, i) => ({ name: `C${i}`, max: 1, min: 0 }))
    expect(sheetProblems({ sections: [{ counters }] })).toEqual(['A sheet can have at most 24 counters.'])
  })
})

describe('normalizeImage', () => {
  const relative = '/api/observatory/images/1a2b3c4d-boar.png'
  it('keeps an Observatory image as the relative URL, however it was given', () => {
    expect(normalizeImage(relative)).toEqual([relative, null])
    expect(normalizeImage(`https://realm.example.com${relative}`)).toEqual([relative, null])
    expect(normalizeImage('1a2b3c4d-boar.png')).toEqual([relative, null])
    expect(normalizeImage("1a2b3c4d-boar (it's big).png")[0]).toBe('/api/observatory/images/1a2b3c4d-boar%20%28it%27s%20big%29.png')
  })

  it('refuses a path that is not an Observatory image', () => {
    expect(normalizeImage('Bestiary/boar.png')).toEqual([null, expect.stringMatching(/Observatory/)])
    expect(normalizeImage('')).toEqual([null, null])
  })
})
