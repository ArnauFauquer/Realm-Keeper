import { computed } from 'vue'
import { useSyncedDocs } from './useSyncedDoc'
import { charactersApi } from '@/api/docs'
import { characterStateFromSheet, counterFromSpec } from '@/utils/encounter'

/**
 * The saved values of some `character` sheets, one live document each (backend
 * models/characters.py), shared by every note, encounter and map that shows
 * them. `ids` is a function returning the sheet ids to follow (they may change).
 */
export function useCharacters(ids) {
  const { docs, statusOf, reload, commit } = useSyncedDocs('character', ids, (id) => charactersApi.fetch(id))
  const { commands } = charactersApi

  const stateOf = (sheetId) => docs.value[sheetId] || null

  /** 'loading' while any of them is on its way, 'ready' once each is loaded or known not to exist. */
  const status = computed(() => ((ids() || []).some((id) => ['loading', 'idle'].includes(statusOf(id))) ? 'loading' : 'ready'))

  /** Saves a character, from its sheet, if it has nothing saved yet. */
  const ensure = async (sheet) => {
    const result = await charactersApi.ensure(sheet.id, characterStateFromSheet(sheet))
    if (result.created) await reload(sheet.id)
    return result
  }

  const adjust = (sheetId, resource, by) => commit(sheetId, commands.adjustOwn(sheetId, resource, by))

  /**
   * Brings the saved counters' definitions (and the name) in line with the
   * sheet, which may have changed since: a new counter appears, a changed max
   * or colour is taken, and the current value is kept (within its new range).
   */
  const reconcile = async (sheet) => {
    const state = stateOf(sheet.id)
    if (!state) return null
    const patch = {}
    const resources = {}
    for (const [name, spec] of Object.entries(sheet.resources || {})) {
      const saved = state.resources?.[name]
      const wanted = counterFromSpec(spec)
      if (!saved) {
        resources[name] = wanted
      } else if (
        saved.max !== wanted.max || saved.min !== wanted.min ||
        (saved.color ?? null) !== wanted.color || (saved.style ?? null) !== wanted.style
      ) {
        resources[name] = {
          max: wanted.max,
          min: wanted.min,
          color: wanted.color,
          style: wanted.style,
          current: Math.max(wanted.min, Math.min(wanted.max, saved.current))
        }
      }
    }
    if (Object.keys(resources).length) patch.resources = resources
    if (sheet.name && state.name !== sheet.name) patch.name = sheet.name
    if (!Object.keys(patch).length) return null
    return commit(sheet.id, commands.patch(sheet.id, patch))
  }

  return { docs, status, statusOf, stateOf, ensure, adjust, reconcile }
}
