import { computed, ref } from 'vue'
import { getCached, invalidateCached, put } from '@/api/http'
import { noteApi, noteRawApi } from '@/utils/noteUrls'
import { notifyNotesChanged } from './useNotes'

/**
 * The editor's copy of a note. A save says which version of the file it was
 * written against (`base_sha`, the sha the editor loaded), so someone else's
 * save in the meantime isn't silently overwritten: the server answers 409,
 * the draft is kept, and `conflict` offers to reload their version or
 * overwrite it. A new note is saved as "create only" (base_sha "").
 *
 * `start` is what the editor opened with: `{ content, sha, creating }`.
 */
export function useNoteDraft(path, start) {
  const original = ref(start.content)
  const draft = ref(start.content)
  const baseSha = ref(start.sha ?? null)
  const creating = ref(!!start.creating)
  const saving = ref(false)
  const saveError = ref(null)
  const conflict = ref(false)

  const dirty = computed(() => draft.value !== original.value)

  /** Saves the draft; true once it is stored. `overwrite` skips the version check. */
  async function save({ overwrite = false } = {}) {
    saving.value = true
    saveError.value = null
    try {
      const body = { content: draft.value }
      if (!overwrite) body.base_sha = creating.value ? '' : baseSha.value
      const reply = await put(noteApi(path()), body)
      invalidateCached(noteApi(path()))
      invalidateCached(noteRawApi(path()))
      notifyNotesChanged()
      original.value = draft.value
      baseSha.value = reply?.sha ?? null
      creating.value = false
      conflict.value = false
      return true
    } catch (err) {
      conflict.value = err.response?.status === 409
      saveError.value = conflict.value
        ? (creating.value
            ? 'A note with this name was created while you were writing.'
            : 'Someone else saved this note while you were editing it.')
        : err.response?.data?.detail || err.message || 'Could not save the note.'
      return false
    } finally {
      saving.value = false
    }
  }

  /** Drops the draft for the note as it is stored now. */
  async function reloadTheirs() {
    saving.value = true
    saveError.value = null
    try {
      const data = await getCached(noteRawApi(path()), { useCache: false })
      original.value = data.content
      draft.value = data.content
      baseSha.value = data.sha ?? null
      creating.value = false
      conflict.value = false
    } catch (err) {
      saveError.value = err.response?.data?.detail || err.message || 'Could not load the note.'
    } finally {
      saving.value = false
    }
  }

  return { draft, dirty, creating, saving, saveError, conflict, save, reloadTheirs }
}
