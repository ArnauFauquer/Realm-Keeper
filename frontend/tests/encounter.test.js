import { describe, it, expect } from 'vitest'
import {
  combatantsFromSheet, counterFromSpec, customCombatant, moveBefore
} from '@/utils/encounter'

const BUGBOAR = {
  ref: 'Bestiary/bugboar', id: 'Bestiary/bugboar', name: 'Bugboar', type: 'adversary',
  image: '/api/observatory/images/1a2b3c4d-bugboar.png',
  resources: {
    HP: { max: 6, min: 0, start: null, color: 'red', style: null },
    Stress: { max: 3, min: 0, start: 0, color: null, style: 'pips' }
  }
}
const ARIA = { ref: 'aria', id: 'aria', name: 'Aria', type: 'character', image: 'https://cdn.example.com/aria.png', resources: { HP: { max: 12 } } }

describe('counterFromSpec', () => {
  it('starts at the max unless the sheet says where', () => {
    expect(counterFromSpec({ max: 6 })).toEqual({ current: 6, max: 6, min: 0, color: null, style: null })
    expect(counterFromSpec({ max: 3, start: 0, min: 0 }).current).toBe(0)
    expect(counterFromSpec({ max: 3, start: 2, color: 'gold' })).toMatchObject({ current: 2, color: 'gold' })
  })

  it('starts within the range, as the backend starts a character (sheet_docs.py)', () => {
    expect(counterFromSpec({ max: 3, start: 9 }).current).toBe(3)
    expect(counterFromSpec({ max: 3, min: 1, start: -2 }).current).toBe(1)
  })
})

describe('combatantsFromSheet', () => {
  it('copies an adversary\'s counters into each copy', () => {
    const [one, two] = combatantsFromSheet(BUGBOAR, 2)
    expect([one.name, two.name]).toEqual(['Bugboar 1', 'Bugboar 2'])
    expect(one.resources.HP).toEqual({ current: 6, max: 6, min: 0, color: 'red', style: null })
    expect(one.resources.Stress.current).toBe(0)
    expect(one.resources).not.toBe(two.resources)
    expect(one).toMatchObject({ type: 'adversary', sheet: 'Bestiary/bugboar', image_url: BUGBOAR.image })
  })

  it('does not number a lone copy, and continues the numbering when adding more', () => {
    expect(combatantsFromSheet(BUGBOAR, 1)[0].name).toBe('Bugboar')
    const existing = [{ sheet: BUGBOAR.ref }, { sheet: BUGBOAR.ref }]
    expect(combatantsFromSheet(BUGBOAR, 2, existing).map((c) => c.name)).toEqual(['Bugboar 3', 'Bugboar 4'])
    expect(combatantsFromSheet(BUGBOAR, 1, [{ sheet: BUGBOAR.ref }])[0].name).toBe('Bugboar 2')
    // a character that happens to share the id is not a copy
    expect(combatantsFromSheet(BUGBOAR, 1, [{ sheet: BUGBOAR.ref, type: 'character' }])[0].name).toBe('Bugboar')
  })

  it('adds a character once, with no counters, and no image the screen could not load', () => {
    expect(combatantsFromSheet(ARIA, 5)).toEqual([{ name: 'Aria', type: 'character', sheet: 'aria', image_url: null }])
  })
})

describe('customCombatant', () => {
  it('is an adversary with nothing to track yet', () => {
    expect(customCombatant('Guard')).toEqual({ name: 'Guard', type: 'adversary', resources: {} })
  })
})

describe('moveBefore', () => {
  const ids = ['a', 'b', 'c', 'd']

  it('puts one before another, from either side', () => {
    expect(moveBefore(ids, 'd', 1)).toEqual(['a', 'd', 'b', 'c'])
    expect(moveBefore(ids, 'a', 3)).toEqual(['b', 'c', 'a', 'd'])
  })

  it('puts one first, or last (the index past the end)', () => {
    expect(moveBefore(ids, 'c', 0)).toEqual(['c', 'a', 'b', 'd'])
    expect(moveBefore(ids, 'a', 4)).toEqual(['b', 'c', 'd', 'a'])
  })

  it('leaves the order as it is when the place is its own, or just after it', () => {
    expect(moveBefore(ids, 'b', 1)).toEqual(ids)
    expect(moveBefore(ids, 'b', 2)).toEqual(ids)
  })

  it('does not touch the list it is given, and ignores an id that is not there', () => {
    moveBefore(ids, 'd', 0)
    expect(ids).toEqual(['a', 'b', 'c', 'd'])
    expect(moveBefore(ids, 'zzz', 0)).toBe(ids)
  })
})
