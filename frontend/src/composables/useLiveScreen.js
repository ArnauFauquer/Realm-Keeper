import { ref, watch } from 'vue'
import { post } from '@/api/http'
import { apiUrl } from '@/config/env'

// Edits arrive far faster than the table needs to see them (a drag fires on
// every pointer move); this keeps the screen smooth without flooding the socket.
const PUSH_INTERVAL_MS = 80

/**
 * Sends a chart/vista to the table screen and, while `live` is on, mirrors its
 * unsaved edits there as they're made — the screen shows what the editor shows,
 * saved or not. Shared by the Charts and Vistas modals.
 *
 * @param kind        'chart' | 'vista' (selects /api/screen/<kind>[/live])
 * @param source      ref to the document being edited (watched deeply)
 * @param buildPayload  document -> body of the live update (must carry `<kind>_id`)
 */
export function useLiveScreen(kind, source, buildPayload) {
  const live = ref(false)
  const sending = ref(false)

  let timer = null
  let dirty = false
  let inflight = null

  async function pushDraft() {
    timer = null
    if (!live.value || !dirty || !source.value) return
    dirty = false
    inflight = post(`${apiUrl}/api/screen/${kind}/live`, buildPayload(source.value))
      .then((res) => {
        // Something else replaced this on screen (sent from elsewhere, or
        // cleared): editing it no longer shows anywhere, so stop mirroring.
        if (res?.status === 'ignored') live.value = false
      })
      .catch((err) => console.error(`Failed to mirror ${kind} edit on screen:`, err))
    await inflight
    inflight = null
    if (dirty) schedule()
  }

  function schedule() {
    dirty = true
    if (!live.value || timer || inflight) return
    timer = setTimeout(pushDraft, PUSH_INTERVAL_MS)
  }

  watch(source, schedule, { deep: true })

  async function show() {
    if (!source.value) return
    await post(`${apiUrl}/api/screen/${kind}`, { [`${kind}_id`]: source.value.id })
    // Showing replaces whatever draft the screen had: put the current edits
    // back so a live screen never falls back to the saved version.
    if (live.value) schedule()
  }

  async function sendToScreen() {
    if (!source.value) return
    try {
      await show()
      sending.value = true
      setTimeout(() => { sending.value = false }, 2000)
    } catch (err) {
      console.error(`Failed to send ${kind} to screen:`, err)
    }
  }

  async function start() {
    if (!source.value || live.value) return
    live.value = true
    try {
      await show()
      schedule()
    } catch (err) {
      live.value = false
      console.error(`Failed to start live ${kind}:`, err)
    }
  }

  /** `revert`: the screen is showing edits that were never saved (or are being
   * discarded), so put the saved version back. */
  async function stop({ revert = false } = {}) {
    if (!live.value) return
    live.value = false
    clearTimeout(timer)
    timer = null
    dirty = false
    const doc = source.value
    try {
      // A draft already on its way must land before the revert, not after.
      await inflight
      if (revert && doc) await post(`${apiUrl}/api/screen/${kind}`, { [`${kind}_id`]: doc.id })
    } catch (err) {
      console.error(`Failed to stop live ${kind}:`, err)
    }
  }

  function toggle(hasUnsavedChanges = false) {
    return live.value ? stop({ revert: hasUnsavedChanges }) : start()
  }

  // A different document means a new editing session; never carry live over.
  watch(() => source.value?.id, () => { if (live.value) stop() })

  return { live, sending, sendToScreen, toggle, stop }
}
