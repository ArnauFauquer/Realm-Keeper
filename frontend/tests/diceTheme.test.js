import { describe, expect, it } from 'vitest'
import { DEFAULT_DICE_THEME, DICE_KIND_THEMES, PLAYER_DICE_THEMES, themeForSlot } from '@/dice/diceTheme'

describe('themeForSlot', () => {
  it('gives each of the first players a different colour', () => {
    const backgrounds = PLAYER_DICE_THEMES.map((_, slot) => themeForSlot(slot).bg)
    expect(new Set(backgrounds).size).toBe(PLAYER_DICE_THEMES.length)
  })

  it('wraps around when there are more players than colours', () => {
    expect(themeForSlot(PLAYER_DICE_THEMES.length)).toBe(themeForSlot(0))
    expect(themeForSlot(PLAYER_DICE_THEMES.length + 2)).toBe(themeForSlot(2))
  })

  it('falls back to the default theme without a valid slot', () => {
    expect(themeForSlot(undefined)).toBe(DEFAULT_DICE_THEME)
    expect(themeForSlot(null)).toBe(DEFAULT_DICE_THEME)
    expect(themeForSlot(-1)).toBe(DEFAULT_DICE_THEME)
  })

  it('never collides with the Hope and Fear colours', () => {
    const reserved = Object.values(DICE_KIND_THEMES).map(t => t.bg)
    PLAYER_DICE_THEMES.forEach(t => expect(reserved).not.toContain(t.bg))
  })
})
