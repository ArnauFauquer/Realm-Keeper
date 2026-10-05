// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createMarkdown } from '@/utils/markdown'
import {
  findRangeIndex,
  parseRollHeader,
  parseRowRange,
  planRollTable,
  readRowRanges,
  rollVirtual,
  rowOutcome
} from '@/utils/rollTables'

describe('parseRollHeader', () => {
  it('reads a die, in code or emphasis too', () => {
    expect(parseRollHeader('d20')).toEqual({ formula: 'd20' })
    expect(parseRollHeader('`2d6`')).toEqual({ formula: '2d6' })
    expect(parseRollHeader('**D%**')).toEqual({ formula: 'd%' })
    expect(parseRollHeader('d7')).toEqual({ formula: 'd7' })
  })

  it('takes a bare d as "size it to the table"', () => {
    expect(parseRollHeader('d')).toEqual({ auto: true })
  })

  it('leaves ordinary headers alone', () => {
    expect(parseRollHeader('Name')).toBeNull()
    expect(parseRollHeader('d1')).toBeNull()
    expect(parseRollHeader('')).toBeNull()
  })
})

describe('parseRowRange', () => {
  it('reads numbers, ranges and open ends', () => {
    expect(parseRowRange('7')).toEqual({ min: 7, max: 7 })
    expect(parseRowRange('2-3')).toEqual({ min: 2, max: 3 })
    expect(parseRowRange('01 – 05')).toEqual({ min: 1, max: 5 })
    expect(parseRowRange('96-00')).toEqual({ min: 96, max: 100 })
    expect(parseRowRange('11+')).toEqual({ min: 11, max: null })
  })

  it('rejects anything else', () => {
    expect(parseRowRange('Goblins')).toBeNull()
    expect(parseRowRange('')).toBeNull()
    expect(parseRowRange('5-2')).toBeNull()
  })
})

describe('planRollTable', () => {
  it('matches rows by their numbers', () => {
    const plan = planRollTable('d6', ['1-2', '3-5', '6'])
    expect(plan).toEqual({
      formula: 'd6',
      virtual: false,
      ranges: [{ min: 1, max: 2 }, { min: 3, max: 5 }, { min: 6, max: 6 }]
    })
  })

  it('counts rows from 1 when they have no numbers', () => {
    expect(planRollTable('d4', ['Rain', '', 'Fog', 'Sun']).ranges.map(r => r.min)).toEqual([1, 2, 3, 4])
  })

  it('sizes a bare d to the table: a real die when there is one', () => {
    const rows = Array.from({ length: 20 }, (v, i) => `Entry ${i}`)
    expect(planRollTable('d', rows)).toMatchObject({ formula: 'd20', virtual: false })
    expect(planRollTable('d', ['1-5', '6-10', '11-20'])).toMatchObject({ formula: 'd20', virtual: false })
  })

  it('draws a number when no die fits', () => {
    expect(planRollTable('d', ['a', 'b', 'c', 'd', 'e', 'f', 'g'])).toMatchObject({ formula: 'd7', virtual: true })
    expect(planRollTable('d3', ['a', 'b', 'c'])).toMatchObject({ formula: 'd3', virtual: true })
  })

  it('is null for an ordinary or empty table', () => {
    expect(planRollTable('Name', ['1'])).toBeNull()
    expect(planRollTable('d6', [])).toBeNull()
  })
})

describe('rollVirtual', () => {
  it('rolls within the die, in the shape of a physical roll', () => {
    expect(rollVirtual('d7', () => 0)).toEqual({ total: 1, groups: [{ sides: 7, sign: 1, rolls: [1] }], flatModifier: 0 })
    expect(rollVirtual('2d3', () => 0.999).total).toBe(6)
    expect(rollVirtual('d20+1')).toBeNull()
  })
})

describe('findRangeIndex', () => {
  const ranges = [{ min: 2, max: 6 }, { min: 7, max: 7 }, { min: 8, max: null }]
  it('finds the row holding a total', () => {
    expect(findRangeIndex(ranges, 7)).toBe(1)
    expect(findRangeIndex(ranges, 12)).toBe(2)
    expect(findRangeIndex(ranges, 1)).toBe(-1)
  })
})

describe('roll tables in notes', () => {
  const render = (src, opts) => createMarkdown(opts).render(src)

  it('marks the table, its die and each row', () => {
    const html = render('| d6 | Weather |\n|---|---|\n| 1-3 | Rain |\n| 4-5 | Fog |\n| 6+ | Sun |')
    expect(html).toContain('<table class="roll-table">')
    expect(html).toContain('data-roll-table="d6"')
    expect(html).toContain('<tr data-roll-min="1" data-roll-max="3">')
    expect(html).toContain('<tr data-roll-min="6">')
  })

  it('flags a table with no physical die', () => {
    const html = render('| d | Name |\n|---|---|\n| | Ana |\n| | Bo |\n| | Cy |')
    expect(html).toContain('data-roll-virtual')
    expect(html).toContain('data-roll-table="d3"')
  })

  it('leaves other tables and sheets alone', () => {
    expect(render('| Name | HP |\n|---|---|\n| Orc | 15 |')).not.toContain('roll-table')
    expect(render('| d6 | X |\n|---|---|\n| 1 | a |', { refKinds: ['dice'] })).not.toContain('roll-table')
  })

  it('reads back from the rendered rows', () => {
    const host = document.createElement('div')
    host.innerHTML = render('| d4 | Loot | Value |\n|---|---|---|\n| 1-3 | Coins | 5 gp |\n| 4 | Gem | |')
    const rows = [...host.querySelectorAll('tbody tr')]
    const ranges = readRowRanges(rows)
    expect(ranges).toEqual([{ min: 1, max: 3 }, { min: 4, max: 4 }])
    expect(rowOutcome(rows[findRangeIndex(ranges, 2)], 2)).toBe('Coins · 5 gp')
    expect(rowOutcome(rows[findRangeIndex(ranges, 4)], 4)).toBe('Gem')
    expect(rowOutcome(null, 9)).toBe('No row for 9')
  })
})
