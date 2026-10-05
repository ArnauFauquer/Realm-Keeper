// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { parseDiceFormula } from '@/utils/diceNotation'
import { randomDieValue, rollWithoutDice } from '@/dice/randomRoll'

const screenDice = vi.fn()
const createDiceWorld = vi.fn()
vi.mock('@/api/screen', () => ({ screenApi: { dice: (...args) => screenDice(...args) } }))
vi.mock('@/composables/useAuth', () => ({ useAuth: () => ({ user: ref({ name: 'Aria', diceSlot: 1 }) }) }))
vi.mock('@/dice/diceWorld', () => ({ createDiceWorld: (...args) => createDiceWorld(...args) }))

let dice

beforeEach(async () => {
  vi.resetModules()
  screenDice.mockReset()
  screenDice.mockResolvedValue({})
  createDiceWorld.mockReset()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const { useDiceRoller } = await import('@/composables/useDiceRoller')
  dice = useDiceRoller()
  dice.registerCanvas(document.createElement('canvas'))
})

afterEach(() => {
  dice.disposeWorld()
  vi.restoreAllMocks()
})

describe('useDiceRoller without WebGL', () => {
  beforeEach(() => {
    createDiceWorld.mockImplementation(() => { throw new Error('Error creating WebGL context.') })
  })

  it('still rolls: a result, a toast and the screen broadcast', async () => {
    const result = await dice.roll('2d6+3')
    expect(result.groups).toEqual([{ sides: 6, sign: 1, rolls: expect.any(Array) }])
    expect(result.groups[0].rolls).toHaveLength(2)
    expect(result.total).toBe(result.groups[0].rolls[0] + result.groups[0].rolls[1] + 3)
    expect(dice.state.toasts).toHaveLength(1)
    expect(dice.state.toasts[0]).toMatchObject({ formula: '2d6 + 3', label: 'Aria', total: result.total })
    expect(screenDice).toHaveBeenCalledWith({
      formula: '2d6 + 3', label: null, groups: result.groups, flatModifier: 3, total: result.total
    })
    expect(dice.state.isRolling).toBe(false)
    expect(dice.state.overlayVisible).toBe(false)
  })

  it('does not try to build the dice again on the next roll', async () => {
    await dice.roll('1d20')
    await dice.roll('1d20')
    expect(createDiceWorld).toHaveBeenCalledTimes(1)
    expect(dice.state.toasts).toHaveLength(2)
  })
})

describe('rollWithoutDice', () => {
  it('returns the same shape as a 3D roll, keep and kinds included', () => {
    const result = rollWithoutDice(parseDiceFormula('hf+4d6kh3-2'))
    expect(result.groups.map(g => [g.sides, g.kind, g.rolls.length])).toEqual([[12, 'hope', 1], [12, 'fear', 1], [6, undefined, 4]])
    expect(result.groups[2].dropped).toHaveLength(1)
    expect(result.flatModifier).toBe(-2)
    const kept = result.groups[2].rolls.filter((v, i) => !result.groups[2].dropped.includes(i))
    expect(result.total).toBe(result.groups[0].rolls[0] + result.groups[1].rolls[0] + kept.reduce((a, b) => a + b) - 2)
  })

  it('keeps every value on a face of its die', () => {
    for (const sides of [2, 4, 6, 8, 10, 12, 20, 100]) {
      const { groups } = rollWithoutDice(parseDiceFormula(`25d${sides === 100 ? '%' : sides}`))
      expect(groups[0].rolls.every(v => Number.isInteger(v) && v >= 1 && v <= sides)).toBe(true)
    }
  })

  it('throws away the draws that would favour low faces', () => {
    const draws = [0xffffffff, 7]
    expect(randomDieValue(6, () => draws.shift())).toBe(2)
    expect(draws).toHaveLength(0)
  })
})
