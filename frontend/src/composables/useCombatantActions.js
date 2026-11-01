import { reactive } from 'vue'
import { encountersApi } from '@/api/docs'
import { fetchSheet } from '@/api/sheets'
import { sheetFromDoc } from '@/utils/sheet'

/**
 * What can be done to an encounter's combatants, wherever they are played
 * (the encounter tracker, a battlemap's sheet panel): the same commands, so
 * both stay one thing. `encounterId()` is the encounter's id, `send(command)`
 * runs one of its commands and applies the event it returns, `attempt(work)`
 * waits for any other work (both show what went wrong), and `characters` is
 * useCharacters of the encounter's characters, whose counters are their own.
 */
export function useCombatantActions({ encounterId, send, attempt, characters }) {
  const { commands } = encountersApi

  /** A combatant's counters as [{ name, current, max, min, color, style }]:
   * an adversary's own, a character's saved ones. */
  function countersOf(c) {
    const resources = c.type === 'character' ? characters.stateOf(c.sheet)?.resources : c.resources
    return Object.entries(resources || {}).map(([name, state]) => ({ name, ...state }))
  }

  function adjust(c, resource, by) {
    // (The characters' composable applies its own events.)
    if (c.type === 'character') return attempt(characters.adjust(c.sheet, resource, by))
    return send(commands.adjust(encounterId(), 'combatants', c.id, resource, by))
  }

  const patch = (c, fields) => send(commands.patchItem(encounterId(), 'combatants', c.id, fields))

  // Conditions go in and out one by one, never as the whole list: two people
  // adding one at once both add theirs.
  let conditionSeq = 0
  function addCondition(c, name) {
    const condition = { id: `${Date.now().toString(36)}${conditionSeq++}`, name }
    return send(commands.editList(encounterId(), 'combatants', c.id, 'conditions', { add: [condition] }))
  }

  const removeCondition = (c, condition) =>
    send(commands.editList(encounterId(), 'combatants', c.id, 'conditions', { remove: [condition.id] }))

  return { countersOf, adjust, patch, addCondition, removeCondition }
}

/**
 * The sheets of an encounter's combatants, to play them from: a character's
 * from its live document (an edit to it shows at once), an adversary's
 * template fetched the first time it is asked for, once. `sheetOf(c)` is
 * { status: 'none' | 'loading' | 'missing' | 'ready', sheet }; `load(c)`
 * fetches an adversary's ahead of being shown. A character and an adversary
 * may share an id, so the type is part of the key.
 */
export function useCombatantSheets(characters) {
  const fetched = reactive({}) // by key: { status, sheet }
  const drawn = new WeakMap() // a character's `sheet` body -> { name, sheet }

  const keyOf = (c) => `${c.type || 'adversary'}:${c.sheet}`

  async function load(c) {
    if (!c?.sheet || c.type === 'character') return
    const key = keyOf(c)
    if (fetched[key]) return
    fetched[key] = { status: 'loading' }
    try {
      const entry = await fetchSheet(c.type || 'adversary', c.sheet)
      fetched[key] = { status: 'ready', sheet: entry.sheet }
    } catch {
      fetched[key] = { status: 'missing' }
    }
  }

  function characterSheet(c) {
    const doc = characters.stateOf(c.sheet)
    if (!doc) return { status: characters.status?.value === 'loading' ? 'loading' : 'missing' }
    // Drawn once per version of the sheet: playing a counter changes the
    // document, not its sheet.
    const body = doc.sheet || {}
    const known = typeof body === 'object' ? drawn.get(body) : null
    if (known && known.name === doc.name) return { status: 'ready', sheet: known.sheet }
    try {
      const { sheet } = sheetFromDoc({ ...doc, sheet: body }, 'character')
      if (typeof body === 'object') drawn.set(body, { name: doc.name, sheet })
      return { status: 'ready', sheet }
    } catch {
      return { status: 'missing' }
    }
  }

  function sheetOf(c) {
    if (!c?.sheet) return { status: 'none' }
    if (c.type === 'character') return characterSheet(c)
    return fetched[keyOf(c)] || { status: 'loading' }
  }

  return { sheetOf, load, keyOf }
}
