// Shared face-texture theme so a roll looks the same whether it's animated
// locally (useDiceRoller.js) or replayed on the /screen display (ScreenView.vue).
export const DEFAULT_DICE_THEME = {
  bg: '#241b4d',
  fg: '#f0f0ff',
  accent: 'rgba(199, 178, 255, 0.55)'
}

// The Hope & Fear pair (see utils/diceNotation.js) has to be told apart at a
// glance, so each half gets its own colours instead of the default theme.
export const DICE_KIND_THEMES = {
  hope: {
    bg: '#e3b341',
    fg: '#2b1d00',
    accent: 'rgba(90, 60, 0, 0.55)'
  },
  fear: {
    bg: '#4a0e24',
    fg: '#ffe3ec',
    accent: 'rgba(255, 128, 168, 0.55)'
  }
}

// One colour per signed-in player, picked by their position in the backend's
// ALLOWED_EMAILS (the `diceSlot` from /api/auth/me and on screen dice_roll
// messages). Kept clear of the Hope (gold) and Fear (wine) colours above, which
// a Duality roll still uses whoever throws it. More players than entries wrap
// around.
export const PLAYER_DICE_THEMES = [
  { bg: '#241b4d', fg: '#f0f0ff', accent: 'rgba(199, 178, 255, 0.55)' }, // violet
  { bg: '#0f4c5c', fg: '#e0fbff', accent: 'rgba(125, 226, 245, 0.55)' }, // teal
  { bg: '#14532d', fg: '#e6ffee', accent: 'rgba(134, 239, 172, 0.55)' }, // emerald
  { bg: '#1e3a8a', fg: '#e8efff', accent: 'rgba(147, 181, 255, 0.55)' }, // sapphire
  { bg: '#9a3412', fg: '#fff1e6', accent: 'rgba(253, 186, 116, 0.55)' }, // ember
  { bg: '#86198f', fg: '#fdeaff', accent: 'rgba(240, 171, 252, 0.55)' }, // magenta
  { bg: '#3f6212', fg: '#f4ffe0', accent: 'rgba(190, 242, 100, 0.55)' }, // moss
  { bg: '#e8e1cf', fg: '#1f1a10', accent: 'rgba(90, 76, 40, 0.55)' },    // ivory
  { bg: '#334155', fg: '#f1f5f9', accent: 'rgba(148, 163, 184, 0.65)' }, // slate
  { bg: '#be185d', fg: '#fff0f6', accent: 'rgba(249, 168, 212, 0.55)' }  // rose
]

/** The dice colours for a player's slot; no slot (auth disabled, or a roll
 * from before this field existed) gets the default theme. */
export function themeForSlot(slot, fallback = DEFAULT_DICE_THEME) {
  if (!Number.isInteger(slot) || slot < 0) return fallback
  return PLAYER_DICE_THEMES[slot % PLAYER_DICE_THEMES.length]
}

export function themeForKind(kind, fallback = DEFAULT_DICE_THEME) {
  return DICE_KIND_THEMES[kind] || fallback
}
