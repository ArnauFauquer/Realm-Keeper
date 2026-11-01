import { computed } from 'vue'
import { useSyncedDocs } from './useSyncedDoc'
import { charactersApi } from '@/api/docs'

/**
 * Some characters, one live document each (backend models/characters.py):
 * their sheet (`source`) and the current values of its counters, shared by
 * every note, encounter and map that shows them. `ids` is a function returning
 * the characters' ids to follow (they may change).
 */
export function useCharacters(ids) {
  const { docs, statusOf, commit } = useSyncedDocs('character', ids, (id) => charactersApi.fetch(id))
  const { commands } = charactersApi

  const stateOf = (id) => docs.value[id] || null

  /** 'loading' while any of them is on its way, 'ready' once each is loaded or known not to exist. */
  const status = computed(() => ((ids() || []).some((id) => ['loading', 'idle'].includes(statusOf(id))) ? 'loading' : 'ready'))

  const adjust = (id, resource, by) => commit(id, commands.adjustOwn(id, resource, by))

  /** Sets top-level fields (`source`, `name`...); the counters follow the sheet on the server. */
  const patch = (id, fields) => commit(id, commands.patch(id, fields))

  return { docs, status, statusOf, stateOf, adjust, patch }
}
