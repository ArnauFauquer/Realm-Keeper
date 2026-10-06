import { ref, shallowRef } from 'vue'
import { errorMessage, getCached } from '@/api/http'
import { apiUrl } from '@/config/env'
import { noteApi, noteRawApi } from '@/utils/paths'

/**
 * The note a view shows. Each load() takes a token, and an answer that comes
 * back for an older one is dropped: clicking A then B quickly must show B,
 * even if A's answer arrives last, and an editor opened on A must not open
 * once the view has moved on to B.
 *
 * A load starts empty (no previous note left next to a "doesn't exist" or an
 * error), so whatever showed the previous note goes with it.
 */
export function useNoteLoader() {
  const note = shallowRef(null)
  const loading = ref(false)
  const error = ref(null)
  const notFound = ref(false)
  let token = 0

  async function load(path) {
    const current = ++token
    note.value = null
    loading.value = true
    error.value = null
    notFound.value = false
    try {
      const data = await getCached(apiUrl + noteApi(path), { cacheTtl: 300 })
      if (current !== token) return false
      note.value = data
      return true
    } catch (err) {
      if (current !== token) return false
      if (err.response?.status === 404) notFound.value = true
      else error.value = errorMessage(err)
      return false
    } finally {
      if (current === token) loading.value = false
    }
  }

  /**
   * The note's file as written, `{ content, sha }`, for the editor; null if
   * the view loaded another note meanwhile. Throws if it can't be read.
   */
  async function loadRaw(path) {
    const current = token
    const data = await getCached(apiUrl + noteRawApi(path), { useCache: false })
    if (current !== token) return null
    return { content: data.content, sha: data.sha ?? null }
  }

  return { note, loading, error, notFound, load, loadRaw }
}
