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

export function themeForKind(kind, fallback = DEFAULT_DICE_THEME) {
  return DICE_KIND_THEMES[kind] || fallback
}
