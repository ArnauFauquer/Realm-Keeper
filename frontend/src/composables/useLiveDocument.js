import { computed, ref } from 'vue'
import { useSyncedDoc } from '@/composables/useSyncedDoc'
import { errorMessage } from '@/api/http'

/**
 * What an editor of a live document (the encounter tracker, the battlemap
 * editor) needs around useSyncedDoc: `send(command)` runs one of the
 * document's commands (the event it returns is applied at once), `attempt`
 * waits for any other work, and either one shows what went wrong in
 * `actionError` (cleared by the next). `unavailable` is true while the
 * document is loading, gone or failed to load (LiveDocumentState says which).
 */
export function useLiveDocument(kind, id, fetch) {
  const { doc, status, error, commit } = useSyncedDoc(kind, id, fetch)
  const actionError = ref('')
  const unavailable = computed(() => ['loading', 'gone', 'error'].includes(status.value))

  /** Waits for `work`, and shows what went wrong. True if nothing did. */
  async function attempt(work) {
    actionError.value = ''
    try {
      await work
      return true
    } catch (err) {
      actionError.value = errorMessage(err)
      return false
    }
  }

  const send = (command) => attempt(commit(command))

  return { doc, status, error, commit, actionError, unavailable, attempt, send }
}
