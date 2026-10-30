// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  dice: vi.fn(),
  createDiceWorld: vi.fn(),
  rollParsedFormula: vi.fn(),
  rollWithoutDice: vi.fn(),
  user: { value: { name: 'Mira', diceSlot: 2 } }
}))
vi.mock('@/api/screen', () => ({ screenApi: { dice: m.dice } }))
vi.mock('@/dice/diceWorld', () => ({ createDiceWorld: m.createDiceWorld }))
vi.mock('@/dice/diceRoller', () => ({ rollParsedFormula: m.rollParsedFormula }))
vi.mock('@/dice/randomRoll', () => ({ rollWithoutDice: m.rollWithoutDice }))
vi.mock('@/dice/diceTheme', () => ({ themeForSlot: (slot) => `theme-${slot}` }))
vi.mock('@/composables/useAuth', () => ({ useAuth: () => ({ user: m.user }) }))

const RESULT = { total: 9, groups: [{ sides: 8, rolls: [4] }], flatModifier: 5 }
let roller, world, canvas

beforeEach(async () => {
  vi.useFakeTimers()
  vi.resetModules()
  m.user.value = { name: 'Mira', diceSlot: 2 }
  world = { resize: vi.fn(), clearDice: vi.fn(), stop: vi.fn(), dispose: vi.fn() }
  m.createDiceWorld.mockReset().mockReturnValue(world)
  m.rollParsedFormula.mockReset().mockResolvedValue({ ...RESULT })
  m.rollWithoutDice.mockReset().mockReturnValue({ ...RESULT })
  m.dice.mockReset().mockResolvedValue()
  canvas = { getBoundingClientRect: () => ({ width: 300, height: 200 }) }
  roller = (await import('@/composables/useDiceRoller')).useDiceRoller()
})
afterEach(() => vi.useRealTimers())

describe('roll', () => {
  it('ignores an invalid formula', async () => {
    expect(await roller.roll('nonsense')).toBeNull()
    expect(m.dice).not.toHaveBeenCalled()
  })

  it('throws 3D dice, toasts the result under the player name and tells the screen', async () => {
    roller.registerCanvas(canvas)
    roller.openPanel()
    const result = await roller.roll('1d8+5')
    expect(result.total).toBe(9)
    expect(world.resize).toHaveBeenCalledWith(300, 200)
    expect(world.clearDice).toHaveBeenCalled()
    expect(m.rollParsedFormula.mock.calls[0][2]).toBe('theme-2')
    expect(roller.state.isPanelOpen).toBe(false)
    expect(roller.state.isRolling).toBe(false)
    expect(roller.state.toasts).toHaveLength(1)
    expect(roller.state.toasts[0]).toMatchObject({ label: 'Mira', total: 9, flatModifier: 5, outcome: null })
    expect(m.dice).toHaveBeenCalledWith(expect.objectContaining({ total: 9, label: null }))
  })

  it('keeps the dice on screen for a moment, then hides and stops them', async () => {
    roller.registerCanvas(canvas)
    await roller.roll('1d8')
    expect(roller.state.overlayVisible).toBe(true)
    vi.advanceTimersByTime(2200)
    expect(roller.state.overlayVisible).toBe(false)
    expect(world.stop).toHaveBeenCalled()
  })

  it('shows the label of a roll made for a sheet, and a table outcome only locally', async () => {
    roller.registerCanvas(canvas)
    await roller.roll('1d8', { label: 'Bugboar · Gore', outcome: (r) => `row ${r.total}` })
    expect(roller.state.toasts[0]).toMatchObject({ label: 'Bugboar · Gore', outcome: 'row 9' })
    expect(JSON.stringify(m.dice.mock.calls[0][0])).not.toContain('row 9')
  })

  it('has no label for an anonymous roll', async () => {
    m.user.value = null
    roller.registerCanvas(canvas)
    await roller.roll('1d8')
    expect(roller.state.toasts[0].label).toBeNull()
  })

  it('does not roll again while one is in flight', async () => {
    roller.registerCanvas(canvas)
    let settle
    m.rollParsedFormula.mockReturnValue(new Promise((r) => { settle = r }))
    const first = roller.roll('1d8')
    await vi.advanceTimersByTimeAsync(0)
    expect(roller.state.isRolling).toBe(true)
    expect(await roller.roll('1d8')).toBeNull()
    settle({ ...RESULT })
    await first
  })

  it('rolls without dice when the canvas is not mounted', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = await roller.roll('1d8')
    expect(result.total).toBe(9)
    expect(m.rollWithoutDice).toHaveBeenCalled()
    expect(roller.state.overlayVisible).toBe(false)
    warn.mockRestore()
  })

  it('remembers that WebGL is unavailable and skips the dice from then on', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    m.createDiceWorld.mockImplementation(() => { throw new Error('no webgl') })
    roller.registerCanvas(canvas)
    await roller.roll('1d8')
    await roller.roll('1d8')
    expect(m.createDiceWorld).toHaveBeenCalledTimes(1)
    expect(m.rollWithoutDice).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })

  it('never lets a failing screen break the roll', async () => {
    m.dice.mockRejectedValue(new Error('offline'))
    roller.registerCanvas(canvas)
    await expect(roller.roll('1d8')).resolves.toBeTruthy()
  })

  it('cancels a pending hide when the next roll starts', async () => {
    roller.registerCanvas(canvas)
    await roller.roll('1d8')
    vi.advanceTimersByTime(1000)
    await roller.roll('1d8')
    vi.advanceTimersByTime(1500)
    expect(roller.state.overlayVisible).toBe(true)
    vi.advanceTimersByTime(800)
    expect(roller.state.overlayVisible).toBe(false)
  })
})

describe('toasts', () => {
  it('expire after seven seconds, or when dismissed', async () => {
    roller.showRoll('1d7', { ...RESULT }, { outcome: 'Goblins' })
    roller.showRoll('1d7', { ...RESULT })
    expect(roller.state.toasts.map((t) => t.outcome)).toEqual(['Goblins', null])
    expect(m.dice).not.toHaveBeenCalled()
    roller.dismissToast(roller.state.toasts[1].id)
    roller.dismissToast(999)
    expect(roller.state.toasts).toHaveLength(1)
    vi.advanceTimersByTime(7000)
    expect(roller.state.toasts).toHaveLength(0)
  })
})

describe('the panel and the world', () => {
  it('opens, closes and toggles the panel', () => {
    roller.openPanel()
    expect(roller.state.isPanelOpen).toBe(true)
    roller.closePanel()
    expect(roller.state.isPanelOpen).toBe(false)
    roller.togglePanel()
    expect(roller.state.isPanelOpen).toBe(true)
  })

  it('resizes the world only once there is one, and disposes it', async () => {
    roller.resizeWorld(1, 1)
    roller.registerCanvas(canvas)
    await roller.roll('1d8')
    roller.resizeWorld(640, 480)
    expect(world.resize).toHaveBeenLastCalledWith(640, 480)
    roller.disposeWorld()
    expect(world.dispose).toHaveBeenCalled()
    roller.resizeWorld(1, 1)
    expect(world.resize).toHaveBeenLastCalledWith(640, 480)
  })

  it('exposes the state read-only', () => {
    roller.state.isPanelOpen = true
    expect(roller.state.isPanelOpen).toBe(false)
  })
})
