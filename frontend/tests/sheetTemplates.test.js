import { describe, it, expect } from 'vitest'
import { MAX_COUNTERS, sheetFromDoc, sheetProblems } from '@/utils/sheet'
import { normalizeBody } from '@/utils/sheetModel'
import { parseDiceFormula } from '@/utils/diceNotation'
import { SHEET_SYSTEMS, sheetTemplate } from '@/utils/sheetTemplates'

const templates = SHEET_SYSTEMS.flatMap((system) =>
  ['character', 'adversary'].map((type) => [`${system.name} ${type}`, system.id, type])
)

// Every roll a sheet keeps: its stats', its entries', and the dice written in
// its texts (`1d8+2`).
function rollsOf(body) {
  const rolls = []
  const inText = (text) => [...(text || '').matchAll(/`([^`]+)`/g)].map((m) => m[1])
  for (const section of body.sections) {
    for (const group of section.stats) for (const stat of group.stats) if (stat.roll) rolls.push(stat.roll)
    for (const item of section.items) {
      if (item.roll) rolls.push(item.roll)
      rolls.push(...inText(item.text))
    }
  }
  return rolls
}

describe('sheet templates', () => {
  it('offers a template for both types in every system', () => {
    for (const system of SHEET_SYSTEMS) {
      expect(Object.keys(system.templates).sort()).toEqual(['adversary', 'character'])
      expect(system.hint.character && system.hint.adversary).toBeTruthy()
    }
  })

  it.each(templates)('the %s template is a sheet the server takes', (_name, id, type) => {
    const body = normalizeBody(sheetTemplate(id, type))
    const { sheet, warnings } = sheetFromDoc({ id: 'new', name: 'New', sheet: body }, type)
    expect(warnings).toEqual([])
    expect(sheetProblems(body)).toEqual([])
    expect(Object.keys(sheet.resources)).toContain('HP')
    expect(Object.keys(sheet.resources).length).toBeLessThanOrEqual(MAX_COUNTERS)
    for (const section of body.sections) {
      for (const counter of section.counters) {
        expect(counter.name.length).toBeLessThanOrEqual(80)
        expect(counter.max).toBeGreaterThan(0)
      }
    }
  })

  it.each(templates)('every roll on the %s template can be rolled', (_name, id, type) => {
    const rolls = rollsOf(normalizeBody(sheetTemplate(id, type)))
    expect(rolls.length).toBeGreaterThan(0)
    for (const roll of rolls) expect(parseDiceFormula(roll), roll).not.toBeNull()
  })

  it('hands out a copy, so editing a sheet leaves the template alone', () => {
    const sheet = sheetTemplate('dnd5e', 'character')
    sheet.sections[0].counters[0].max = 99
    expect(sheetTemplate('dnd5e', 'character').sections[0].counters[0].max).toBe(12)
  })

  it('has nothing for an unknown system', () => {
    expect(sheetTemplate('gurps', 'character')).toBeNull()
  })
})
