import { ref, watch } from 'vue'
import { screenApi } from '@/api/screen'
import { useFlash } from './useFlash'

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
 * @param options.buildShowPayload  document -> body of the request that puts it
 *        on screen. Defaults to `{ <kind>_id }`, which is all a chart/vista
 *        needs; the constellation has no id and sends its whole current state.
 */
export function useLiveScreen(kind, source, buildPayload, { buildShowPayload } = {}) {
  const showPayload = (doc) => (buildShowPayload ? buildShowPayload(doc) : { [`${kind}_id`]: doc.id })

  const live = ref(false)
  const { on: sending, flash: flashSent } = useFlash()

  let timer = null
  let dirty = false
  let inflight = null

  async function pushDraft() {
    timer = null
    if (!live.value || !dirty || !source.value) return
    dirty = false
    inflight = screenApi.live(kind, buildPayload(source.value))
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
    await screenApi.show(kind, showPayload(source.value))
    // Showing replaces whatever draft the screen had: put the current edits
    // back so a live screen never falls back to the saved version.
    if (live.value) schedule()
  }

  async function sendToScreen() {
    if (!source.value) return
    try {
      await show()
      flashSent()
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
      if (revert && doc) await screenApi.show(kind, showPayload(doc))
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
