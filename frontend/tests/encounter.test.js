import { describe, it, expect } from 'vitest'
import {
  characterStateFromSheet, combatantsFromSheet, counterFromSpec, customCombatant, idsByInitiative, nextTurn
} from '@/utils/encounter'

const BUGBOAR = {
  ref: 'Bestiary/Bugboar#bugboar', id: 'bugboar', name: 'Bugboar', type: 'adversary',
  image: '/api/asset-library/assets/asset-library/Bestiary/1a2b3c4d-bugboar.png',
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
})

describe('combatantsFromSheet', () => {
  it('copies an adversary\'s counters into each copy', () => {
    const [one, two] = combatantsFromSheet(BUGBOAR, 2)
    expect([one.name, two.name]).toEqual(['Bugboar 1', 'Bugboar 2'])
    expect(one.resources.HP).toEqual({ current: 6, max: 6, min: 0, color: 'red', style: null })
    expect(one.resources.Stress.current).toBe(0)
    expect(one.resources).not.toBe(two.resources)
    expect(one).toMatchObject({ type: 'adversary', sheet: 'Bestiary/Bugboar#bugboar', image_url: BUGBOAR.image })
  })

  it('does not number a lone copy, and continues the numbering when adding more', () => {
    expect(combatantsFromSheet(BUGBOAR, 1)[0].name).toBe('Bugboar')
    const existing = [{ sheet: BUGBOAR.ref }, { sheet: BUGBOAR.ref }]
    expect(combatantsFromSheet(BUGBOAR, 2, existing).map((c) => c.name)).toEqual(['Bugboar 3', 'Bugboar 4'])
    expect(combatantsFromSheet(BUGBOAR, 1, [{ sheet: BUGBOAR.ref }])[0].name).toBe('Bugboar 2')
  })

  it('adds a character once, with no counters, and no image the screen could not load', () => {
    expect(combatantsFromSheet(ARIA, 5)).toEqual([{ name: 'Aria', type: 'character', sheet: 'aria', image_url: null }])
  })
})

describe('characterStateFromSheet', () => {
  it('keeps a character\'s saved values under its id', () => {
    expect(characterStateFromSheet({ id: 'aria', resources: { HP: { max: 12 }, Hope: { max: 6, start: 2 } } })).toEqual({
      id: 'aria',
      resources: {
        HP: { current: 12, max: 12, min: 0, color: null, style: null },
        Hope: { current: 2, max: 6, min: 0, color: null, style: null }
      }
    })
  })
})

describe('customCombatant', () => {
  it('is an adversary with nothing to track yet', () => {
    expect(customCombatant('Guard')).toEqual({ name: 'Guard', type: 'adversary', resources: {} })
  })
})

describe('nextTurn', () => {
  const list = [{ id: 'a' }, { id: 'b', defeated: true }, { id: 'c' }]

  it('starts the first round at the first combatant', () => {
    expect(nextTurn(list, null, 0)).toEqual({ turn: 'a', round: 1 })
  })

  it('skips the defeated', () => {
    expect(nextTurn(list, 'a', 1)).toEqual({ turn: 'c', round: 1 })
  })

  it('starts a new round when the order comes back round', () => {
    expect(nextTurn(list, 'c', 1)).toEqual({ turn: 'a', round: 2 })
  })

  it('has nobody to give the turn to when everyone is down', () => {
    expect(nextTurn([{ id: 'a', defeated: true }], 'a', 3)).toEqual({ turn: null, round: 3 })
  })

  it('starts over if the one whose turn it was is gone', () => {
    expect(nextTurn(list, 'zzz', 2)).toEqual({ turn: 'a', round: 2 })
  })
})

describe('idsByInitiative', () => {
  it('puts the highest first and keeps the order of those without one', () => {
    const list = [{ id: 'a' }, { id: 'b', initiative: 3 }, { id: 'c', initiative: 12 }, { id: 'd' }, { id: 'e', initiative: 3 }]
    expect(idsByInitiative(list)).toEqual(['c', 'b', 'e', 'a', 'd'])
  })
})
