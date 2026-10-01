import { describe, expect, it } from 'vitest'
import { MAX_DICE, droppedIndices, formatDiceFormula, parseDiceFormula, resolveDuality, resolveNatural, rollClass } from '@/utils/diceNotation'

describe('parseDiceFormula', () => {
  it('parses subtracted dice', () => {
    const parsed = parseDiceFormula('1d20-1d4+2')
    expect(parsed.terms).toEqual([
      { count: 1, sides: 20, sign: 1 },
      { count: 1, sides: 4, sign: -1 }
    ])
    expect(parsed.flatModifier).toBe(2)
    expect(formatDiceFormula(parsed)).toBe('1d20 - 1d4 + 2')
  })

  it('expands hf into a hope and a fear d12', () => {
    const parsed = parseDiceFormula('hf+1d6-1')
    expect(parsed.terms).toEqual([
      { count: 1, sides: 12, sign: 1, kind: 'hope' },
      { count: 1, sides: 12, sign: 1, kind: 'fear' },
      { count: 1, sides: 6, sign: 1 }
    ])
    expect(formatDiceFormula(parsed)).toBe('Hope & Fear + 1d6 - 1')
    expect(formatDiceFormula(parseDiceFormula('HF'))).toBe('Hope & Fear')
  })

  it('rejects a subtracted or repeated hf pair', () => {
    expect(parseDiceFormula('1d6-hf')).toBeNull()
    expect(parseDiceFormula('hf+hf')).toBeNull()
    expect(parseDiceFormula('hff')).toBeNull()
  })
})

describe('resolveDuality', () => {
  const groups = (hope, fear) => [
    { sides: 12, sign: 1, kind: 'hope', rolls: [hope] },
    { sides: 12, sign: 1, kind: 'fear', rolls: [fear] }
  ]

  it('reads critical, hope and fear outcomes', () => {
    expect(resolveDuality(groups(7, 7)).outcome).toBe('critical')
    expect(resolveDuality(groups(9, 3)).outcome).toBe('hope')
    expect(resolveDuality(groups(2, 11)).outcome).toBe('fear')
  })

  it('returns null for a roll without the pair', () => {
    expect(resolveDuality([{ sides: 20, sign: 1, rolls: [12] }])).toBeNull()
  })
})

describe('resolveNatural', () => {
  const d20 = (...rolls) => ({ sides: 20, sign: 1, rolls })

  it('flags a natural 20 or 1 regardless of the modifier', () => {
    expect(resolveNatural([d20(20)])).toEqual({ critical: true, fumble: false })
    expect(resolveNatural([d20(1), { sides: 6, sign: 1, rolls: [6] }])).toEqual({ critical: false, fumble: true })
    expect(resolveNatural([d20(12)])).toEqual({ critical: false, fumble: false })
  })

  it('ignores rolls without an added d20', () => {
    expect(resolveNatural([{ sides: 12, sign: 1, rolls: [1] }])).toBeNull()
    expect(resolveNatural([{ sides: 20, sign: -1, rolls: [20] }])).toBeNull()
  })

  it('marks the individual d20 dice', () => {
    const natural = { critical: true, fumble: false }
    expect(rollClass(d20(20), 0, natural)).toBe('crit')
    expect(rollClass(d20(1), 0, natural)).toBe('fumble')
    expect(rollClass(d20(20), 0, null)).toBeNull()
    expect(rollClass({ sides: 6, sign: 1, rolls: [1] }, 0, natural)).toBeNull()
  })

  it('ignores rolls with more than one d20', () => {
    expect(resolveNatural([d20(20, 5)])).toBeNull()
    expect(resolveNatural([d20(1), d20(13)])).toBeNull()
  })
})

describe('advantage / disadvantage', () => {
  it('parses adv, dis and keep-highest/lowest notation', () => {
    expect(parseDiceFormula('adv+5').terms).toEqual([{ count: 2, sides: 20, sign: 1, keep: { mode: 'high', count: 1 } }])
    expect(parseDiceFormula('DIS').terms[0].keep).toEqual({ mode: 'low', count: 1 })
    expect(parseDiceFormula('4d6kh3').terms[0]).toEqual({ count: 4, sides: 6, sign: 1, keep: { mode: 'high', count: 3 } })
    expect(parseDiceFormula('2d20kl').terms[0].keep).toEqual({ mode: 'low', count: 1 })
    expect(parseDiceFormula('2d20kh2')).toBeNull()
    expect(parseDiceFormula('advx')).toBeNull()
    expect(formatDiceFormula(parseDiceFormula('adv+5'))).toBe('d20 Advantage + 5')
    expect(formatDiceFormula(parseDiceFormula('dis'))).toBe('d20 Disadvantage')
    expect(formatDiceFormula(parseDiceFormula('4d6kh3'))).toBe('4d6kh3')
  })

  it('drops the right dice', () => {
    expect(droppedIndices([7, 15], { mode: 'high', count: 1 })).toEqual([0])
    expect(droppedIndices([7, 15], { mode: 'low', count: 1 })).toEqual([1])
    expect(droppedIndices([9, 9], { mode: 'high', count: 1 })).toEqual([1])
    expect(droppedIndices([3, 6, 1, 4], { mode: 'high', count: 3 })).toEqual([2])
  })

  it('only counts the kept d20 for criticals and fumbles', () => {
    const adv = { sides: 20, sign: 1, rolls: [1, 20], dropped: [0] }
    expect(resolveNatural([adv])).toEqual({ critical: true, fumble: false })
    expect(rollClass(adv, 0, resolveNatural([adv]))).toBe('dropped')
    expect(rollClass(adv, 1, resolveNatural([adv]))).toBe('crit')
    const dis = { sides: 20, sign: 1, rolls: [1, 20], dropped: [1] }
    expect(resolveNatural([dis])).toEqual({ critical: false, fumble: true })
  })
})

describe('dice limit', () => {
  it('rejects formulas throwing more than MAX_DICE dice', () => {
    expect(parseDiceFormula(`${MAX_DICE}d6`)).not.toBeNull()
    expect(parseDiceFormula(`${MAX_DICE}d6+1d4`)).toBeNull()
    expect(parseDiceFormula('26d100')).toBeNull()
    expect(parseDiceFormula('100d20+100d20')).toBeNull()
  })
})
