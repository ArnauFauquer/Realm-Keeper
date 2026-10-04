import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseSheetDoc, parseSheetSource, slugify, normalizeImage, SheetParseError, SHEET_TEMPLATES } from '@/utils/sheet'

// The same files backend/tests/test_sheets.py checks: the two normalizers
// must agree, or a sheet would show one thing in a note and another in the
// encounter picker.
const FIXTURES = fileURLToPath(new URL('../../backend/tests/fixtures/sheets/', import.meta.url))
const files = readdirSync(FIXTURES)
const read = (name) => readFileSync(FIXTURES + name, 'utf-8')

describe('sheet fixtures shared with the backend', () => {
  const valid = files.filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''))
  const invalid = files.filter((f) => f.startsWith('error-')).map((f) => f.replace(/\.yaml$/, ''))

  it('finds the cases', () => {
    expect(valid.length).toBeGreaterThan(3)
    expect(invalid.length).toBeGreaterThan(3)
  })

  it.each(valid)('%s normalizes like the backend', (name) => {
    expect(parseSheetSource(read(`${name}.yaml`))).toEqual(JSON.parse(read(`${name}.json`)))
  })

  it.each(invalid)('%s is rejected', (name) => {
    expect(() => parseSheetSource(read(`${name}.yaml`))).toThrow(SheetParseError)
  })
})

describe('limits', () => {
  it('refuses aliases, which a few lines of can expand to gigabytes', () => {
    expect(() => parseSheetSource('name: A\nresources: &r {HP: 6}\nstats: *r\n')).toThrow(/Invalid YAML/)
  })

  it('does not mind an anchor nothing refers to', () => {
    expect(parseSheetSource('name: A\nsections:\n  - counters:\n      HP: &hp 6\n').sheet.resources.HP.max).toBe(6)
  })

  it('does not parse a sheet that is far too long', () => {
    expect(() => parseSheetSource(`name: A\ntext: ${'x'.repeat(200_000)}`)).toThrow(/longer/)
  })
})

describe('slugify', () => {
  it('drops accents and punctuation', () => {
    expect(slugify('Jabalí Gigante')).toBe('jabali-gigante')
    expect(slugify("  Aria's  Ghost!! ")).toBe('aria-s-ghost')
    expect(slugify('???')).toBe('')
  })
})

describe('normalizeImage', () => {
  it('keeps a library image as the app-relative URL, whatever it was pasted with', () => {
    const relative = '/api/asset-library/assets/asset-library/Maps/1a2b3c4d-boar.png'
    expect(normalizeImage(relative)).toEqual([relative, null])
    expect(normalizeImage(`https://realm.example.com${relative}`)).toEqual([relative, null])
    expect(normalizeImage('asset-library/Maps/1a2b3c4d-boar.png')).toEqual([relative, null])
  })

  it('warns about anything that is not an image URL', () => {
    expect(normalizeImage('Bestiary/boar.png')[0]).toBeNull()
    expect(normalizeImage('Bestiary/boar.png')[1]).toMatch(/asset library/)
    expect(normalizeImage('')).toEqual([null, null])
  })
})

describe('the editor templates', () => {
  it.each(Object.keys(SHEET_TEMPLATES))('the %s template is a valid sheet', (type) => {
    const { sheet, warnings } = parseSheetDoc({ id: 'new', name: 'New', source: SHEET_TEMPLATES[type] }, type)
    expect(sheet.type).toBe(type)
    expect(warnings).toEqual([])
  })
})

describe('a sheet kept as a document', () => {
  it("takes its name, id and type from the document, and says the YAML's are ignored", () => {
    const source = 'name: Old name\nid: old\ntype: adversary\nsubtitle: Ranger\n'
    const { sheet, warnings } = parseSheetDoc({ id: 'party/aria', name: 'Aria', source }, 'character')
    expect([sheet.id, sheet.name, sheet.type, sheet.subtitle]).toEqual(['party/aria', 'Aria', 'character', 'Ranger'])
    expect(warnings).toHaveLength(3)
    expect(warnings.every((w) => w.includes('ignored'))).toBe(true)
  })

  it('is an empty sheet while its source is empty', () => {
    const { sheet, warnings } = parseSheetDoc({ id: 'imp', name: 'Imp', source: '' }, 'adversary')
    expect([sheet.name, sheet.sections, warnings]).toEqual(['Imp', [], []])
    expect(() => parseSheetDoc({ id: 'imp', name: 'Imp', source: '- a list' }, 'adversary')).toThrow(SheetParseError)
  })
})
