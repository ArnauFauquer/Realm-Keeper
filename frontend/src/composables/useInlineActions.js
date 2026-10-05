import { findRangeIndex, readRowRanges, rollVirtual, rowOutcome } from '@/utils/rollTables'
import { useDiceRoller } from './useDiceRoller'
import { usePlayer } from './usePlayer'
import { useSoundEffects } from './useSoundEffects'

// What can be clicked in rendered markdown, nearest first. The placeholders
// come from inlineRefs.js / rollTables.js; the screen buttons from
// useImageScreenButtons.js; note links from the backend's wikilinks.
const ACTIONS = [
  { kind: 'dice', attr: 'data-dice-formula' },
  { kind: 'roll-table', attr: 'data-roll-table' },
  { kind: 'song', attr: 'data-song-key' },
  { kind: 'sfx', attr: 'data-sfx-key' },
  { kind: 'screen', selector: '.img-screen-btn' },
  { kind: 'note-link', selector: 'a[href^="/note/"]' }
]
const SELECTOR = ACTIONS.map((a) => a.selector || `[${a.attr}]`).join(', ')

/**
 * The action an event on `target` triggers inside `root`:
 * `{ kind, el, value }`, or null. Anything inside an embedded document
 * (`.doc-embed`) is left to that component, which handles its own clicks.
 */
export function findInlineAction(target, root) {
  const el = target?.closest?.(SELECTOR)
  if (!el || !root?.contains(el)) return null
  const embed = el.closest('.doc-embed')
  if (embed && root.contains(embed)) return null
  const action = ACTIONS.find((a) => el.matches(a.selector || `[${a.attr}]`))
  const value = action.attr ? el.getAttribute(action.attr) : el.getAttribute('href')
  return { kind: action.kind, el, value }
}

/** Runs a dice / roll-table / song / sfx action found by findInlineAction. */
export function runInlineAction({ kind, el, value }) {
  if (kind === 'dice') return useDiceRoller().roll(value)
  if (kind === 'roll-table') return rollOnTable(el, value)
  if (kind === 'song') return playSong(el, value)
  if (kind === 'sfx') return toggleSfx(el, value)
}

async function playSong(el, key) {
  if (el.classList.contains('loading')) return
  el.classList.add('loading')
  try {
    await usePlayer().playByKey(key)
  } catch (err) {
    console.error('Failed to play track:', err)
    el.classList.add('song-link-error')
    setTimeout(() => el.classList.remove('song-link-error'), 2000)
  } finally {
    el.classList.remove('loading')
  }
}

// Sound-effect buttons toggle their effect over the music; their look
// (playing, progress fill) follows useSoundEffects, see syncSfxButtons.
async function toggleSfx(el, key) {
  try {
    await useSoundEffects().toggle(key)
  } catch (err) {
    console.error('Failed to play sound effect:', err)
    el.classList.add('sfx-button-error')
    setTimeout(() => el.classList.remove('sfx-button-error'), 2000)
  }
}

/** Shows which sound effects are sounding, and how far along, on their buttons. */
export function syncSfxButtons(root, playing) {
  root.querySelectorAll('[data-sfx-key]').forEach((el) => {
    if (el.closest('.doc-embed')) return
    const effect = playing[el.getAttribute('data-sfx-key')]
    el.classList.toggle('is-playing', !!effect)
    el.setAttribute('aria-pressed', effect ? 'true' : 'false')
    el.style.setProperty('--sfx-progress', effect ? effect.progress : 0)
    const icon = el.querySelector('.mdi')
    icon?.classList.toggle('mdi-waveform', !effect)
    icon?.classList.toggle('mdi-stop', !!effect)
  })
}

// A roll table's header die: throws it (or draws the number, for a die
// with no physical body like a d7), then marks the row it landed on.
async function rollOnTable(die, formula) {
  const table = die.closest('table')
  if (!table || table.hasAttribute('data-rolling')) return
  const rows = [...table.querySelectorAll('tbody tr[data-roll-min]')]
  const ranges = readRowRanges(rows)
  const rowFor = (total) => rows[findRangeIndex(ranges, total)] || null
  const outcome = (result) => rowOutcome(rowFor(result.total), result.total)
  const { roll, showRoll } = useDiceRoller()

  table.setAttribute('data-rolling', '')
  try {
    let result
    if (table.hasAttribute('data-roll-virtual')) {
      result = rollVirtual(formula)
      await scanRows(rows)
      // Written like a physical roll's toast: "1d7", not "d7".
      showRoll(formula.replace(/^d/, '1d'), result, { outcome: outcome(result) })
    } else {
      result = await roll(formula, { outcome })
    }
    if (result) markRolledRow(table, die, rowFor(result.total), result.total)
  } finally {
    table.removeAttribute('data-rolling')
  }
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

// A drawn number has no dice to watch, so the highlight runs down a few
// rows first, slowing as it goes: the table itself is what's rolling.
async function scanRows(rows) {
  if (rows.length < 2 || reducedMotion()) return
  let last = -1
  for (let step = 0; step < 9; step++) {
    let next = Math.floor(Math.random() * rows.length)
    if (next === last) next = (next + 1) % rows.length
    rows[last]?.classList.remove('roll-scan')
    rows[next].classList.add('roll-scan')
    last = next
    await new Promise(resolve => setTimeout(resolve, 45 + step * 14))
  }
  rows[last].classList.remove('roll-scan')
}

function markRolledRow(table, die, row, total) {
  table.querySelectorAll('tr.roll-hit').forEach(tr => tr.classList.remove('roll-hit'))
  let badge = die.querySelector('.roll-table-last')
  if (!badge) {
    badge = document.createElement('span')
    badge.className = 'roll-table-last'
    die.appendChild(badge)
  }
  badge.textContent = String(total)
  if (!row) return
  // Restart the landing flash when the same row comes up twice.
  void row.offsetWidth
  row.classList.add('roll-hit')
  row.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' })
}
