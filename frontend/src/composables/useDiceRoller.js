import { reactive, readonly } from 'vue'
import { parseDiceFormula, formatDiceFormula } from '@/utils/diceNotation'
import { post } from '@/api/http'
import { apiUrl } from '@/config/env'
import { DEFAULT_DICE_THEME } from '@/dice/diceTheme'

// Module-scoped singleton (no Pinia in this app) shared by DiceFab,
// DicePanel, DiceOverlay, DiceToastStack and the note-rendering click hook
// in NoteView.vue - whichever of those fires roll()/openPanel() first,
// they all observe the same state.
const state = reactive({
  isPanelOpen: false,
  isRolling: false,
  overlayVisible: false,
  toasts: []
})

const theme = DEFAULT_DICE_THEME

let worldInstance = null
let canvasEl = null
let toastSeq = 0
let hideTimer = null

function registerCanvas(el) {
  canvasEl = el
}

async function ensureWorld() {
  if (worldInstance) return worldInstance
  if (!canvasEl) throw new Error('Dice canvas is not mounted yet')
  const { createDiceWorld } = await import('@/dice/diceWorld')
  worldInstance = createDiceWorld(canvasEl)
  const rect = canvasEl.getBoundingClientRect()
  worldInstance.resize(rect.width || window.innerWidth, rect.height || window.innerHeight)
  return worldInstance
}

function resizeWorld(width, height) {
  if (worldInstance) worldInstance.resize(width, height)
}

function dismissToast(id) {
  const idx = state.toasts.findIndex(t => t.id === id)
  if (idx !== -1) state.toasts.splice(idx, 1)
}

function pushToast(formula, result) {
  const id = ++toastSeq
  state.toasts.push({
    id,
    formula,
    groups: result.groups,
    flatModifier: result.flatModifier,
    total: result.total
  })
  setTimeout(() => dismissToast(id), 7000)
}

/** Best-effort broadcast so the /screen display (a separate, player-facing
 * tab/device) shows the same roll - never lets a screen-broadcast failure
 * affect the local roll/toast. */
function broadcastToScreen(formula, result) {
  post(`${apiUrl}/api/screen/dice`, {
    formula,
    groups: result.groups,
    flatModifier: result.flatModifier,
    total: result.total
  }).catch(() => {})
}

/** Parses and rolls a formula (e.g. "4d8+5"); silently no-ops on an invalid
 * formula or while another roll is still in flight. Returns the result, or
 * null if the roll didn't happen. */
async function roll(formulaText) {
  const parsed = parseDiceFormula(formulaText)
  if (!parsed || state.isRolling) return null

  state.isPanelOpen = false
  state.isRolling = true
  state.overlayVisible = true
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }

  try {
    const world = await ensureWorld()
    world.clearDice()
    const { rollParsedFormula } = await import('@/dice/diceRoller')
    const result = await rollParsedFormula(world, parsed, theme)
    const formula = formatDiceFormula(parsed)
    pushToast(formula, result)
    broadcastToScreen(formula, result)
    return result
  } finally {
    state.isRolling = false
    hideTimer = setTimeout(() => {
      state.overlayVisible = false
      worldInstance?.stop()
      hideTimer = null
    }, 2200)
  }
}

function openPanel() { state.isPanelOpen = true }
function closePanel() { state.isPanelOpen = false }
function togglePanel() { state.isPanelOpen = !state.isPanelOpen }

function disposeWorld() {
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
  worldInstance?.dispose()
  worldInstance = null
  canvasEl = null
}

export function useDiceRoller() {
  return {
    state: readonly(state),
    registerCanvas,
    resizeWorld,
    roll,
    openPanel,
    closePanel,
    togglePanel,
    dismissToast,
    disposeWorld
  }
}
