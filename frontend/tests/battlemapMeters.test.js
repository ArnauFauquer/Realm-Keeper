import { describe, it, expect } from 'vitest'
import { barOptions, metersFor } from '@/utils/battlemapMeters'

const encounter = {
  combatants: [
    { id: 'c1', type: 'adversary', resources: { HP: { current: 2, max: 6, min: 0, color: 'red' }, Stress: { current: 1, max: 3 } } },
    { id: 'c2', type: 'character', sheet: 'aria', resources: {} }
  ]
}
const characters = { aria: { id: 'aria', resources: { HP: { current: 9, max: 12, min: 0 } } } }
const token = (over) => ({ id: 't', combatant: 'c1', show_bars: true, bars: ['HP'], ...over })

describe('metersFor', () => {
  it("shows an adversary's counters from the encounter, as the screens get them", () => {
    expect(metersFor(token(), encounter, characters)).toEqual([{ name: 'HP', current: 2, max: 6, min: 0, color: 'red', style: null }])
  })

  it("shows a character's from its saved values", () => {
    expect(metersFor(token({ combatant: 'c2' }), encounter, characters)).toEqual([
      { name: 'HP', current: 9, max: 12, min: 0, color: null, style: null }
    ])
  })

  it('shows only the ones listed, in that order, and only if told to show any', () => {
    const names = (t) => metersFor(t, encounter, characters).map((m) => m.name)
    expect(names(token({ bars: ['Stress', 'HP', 'Nope'] }))).toEqual(['Stress', 'HP'])
    expect(names(token({ show_bars: false }))).toEqual([])
  })

  it('shows nothing for a token that stands for no one, or whose encounter is not there', () => {
    expect(metersFor(token({ combatant: null }), encounter, characters)).toEqual([])
    expect(metersFor(token({ combatant: 'ghost' }), encounter, characters)).toEqual([])
    expect(metersFor(token(), null, characters)).toEqual([])
    expect(metersFor(token({ combatant: 'c2' }), encounter, null)).toEqual([])
  })
})

describe('barOptions', () => {
  it('lists what a token could show', () => {
    expect(barOptions(token(), encounter, characters)).toEqual(['HP', 'Stress'])
    expect(barOptions(token({ combatant: 'c2' }), encounter, characters)).toEqual(['HP'])
    expect(barOptions(token({ combatant: null }), encounter, characters)).toEqual([])
  })
})
