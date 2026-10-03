import { useSyncedDoc } from './useSyncedDoc'
import { charactersApi } from '@/api/docs'
import { characterStateFromSheet, counterFromSpec } from '@/utils/encounter'

const COLLECTION = 'characters'

/**
 * What is saved about the `character` sheets: their current counters, shared by
 * every note, encounter and map that shows them (see backend models/
 * characters.py). `doc` is the live document; null until `status` is 'ready'.
 */
export function useCharacters() {
  const { doc, status, commit } = useSyncedDoc('characters', 'all', () => charactersApi.fetch())
  const { commands } = charactersApi

  const stateOf = (sheetId) => doc.value?.characters.find((c) => c.id === sheetId) || null

  /** Creates a character's state, from its sheet, if it has none yet. */
  const ensure = (sheet) =>
    commit(commands.addItems(null, COLLECTION, [characterStateFromSheet(sheet)], { ignoreExisting: true }))

  const adjust = (sheetId, resource, by) => commit(commands.adjust(null, COLLECTION, sheetId, resource, by))

  /**
   * Brings the saved counters' definitions in line with the sheet, which may
   * have changed since: a new counter appears, a changed max or colour is
   * taken, and the current value is kept (within its new range).
   */
  const reconcile = async (sheet) => {
    const state = stateOf(sheet.id)
    if (!state) return null
    const patch = {}
    for (const [name, spec] of Object.entries(sheet.resources || {})) {
      const saved = state.resources?.[name]
      const wanted = counterFromSpec(spec)
      if (!saved) {
        patch[name] = wanted
      } else if (
        saved.max !== wanted.max || saved.min !== wanted.min ||
        (saved.color ?? null) !== wanted.color || (saved.style ?? null) !== wanted.style
      ) {
        patch[name] = {
          max: wanted.max,
          min: wanted.min,
          color: wanted.color,
          style: wanted.style,
          current: Math.max(wanted.min, Math.min(wanted.max, saved.current))
        }
      }
    }
    if (!Object.keys(patch).length) return null
    return commit(commands.patchItem(null, COLLECTION, sheet.id, { resources: patch }))
  }

  return { doc, status, stateOf, ensure, adjust, reconcile }
}
