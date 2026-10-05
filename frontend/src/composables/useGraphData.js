import { readonly, ref } from 'vue'
import { getCached } from '@/api/http'
import { apiUrl } from '@/config/env'

// The vault's link graph (every note and the links between them), read by
// the note's mini constellation, the full constellation and the screen's
// mirror of it. One request is shared while it is fresh; saving a note
// invalidates it (see notifyNotesChanged in useNotes.js), and `version` lets
// a view that already drew it know it should fetch again.

const FRESH_FOR_MS = 10 * 60 * 1000

let pending = null
let fetchedAt = 0
const version = ref(0)

export function isValidGraph(data) {
  return !!data && Array.isArray(data.nodes) && Array.isArray(data.links)
}

/**
 * `{ nodes, links }`, shared: callers must copy what they hand to d3 (it
 * writes positions into the objects). `fresh` skips the shared copy.
 */
export function fetchGraph({ fresh = false } = {}) {
  if (!fresh && pending && Date.now() - fetchedAt < FRESH_FOR_MS) return pending
  fetchedAt = Date.now()
  const request = getCached(`${apiUrl}/api/graph/all`, { useCache: false }).then((data) => {
    if (!isValidGraph(data)) throw new Error('Invalid graph data format returned from API')
    return data
  })
  pending = request
  // A failed request isn't kept: the next caller tries again.
  request.catch(() => { if (pending === request) pending = null })
  return request
}

export function invalidateGraph() {
  pending = null
  version.value++
}

export function useGraphData() {
  return { fetchGraph, invalidateGraph, version: readonly(version) }
}
