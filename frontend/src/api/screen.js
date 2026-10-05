import { apiUrl } from '@/config/env'
import { post } from './http'

const base = `${apiUrl}/api/screen`

/** A /screen URL that pairs whichever device opens it (TV, projector, OBS)
 * without it signing in. It only ever receives what's sent to the screen.
 * The key rides in the #fragment, which browsers never send to the server,
 * so it can't end up in the ingress/nginx access logs. */
export async function createScreenLink() {
  const { key } = await post(`${base}/link`)
  return `${window.location.origin}/screen#key=${encodeURIComponent(key)}`
}

/** Trades the key from a screen link for this device's pairing cookie. */
export async function pairScreen(key) {
  await post(`${base}/pair`, { key })
}

// What is sent to the table screen (backend routes/screen.py). Each call
// replaces what the screen shows, except `live`, which only updates a chart,
// vista or constellation that is already on it.
const show = (kind, payload) => post(`${base}/${kind}`, payload)

export const screenApi = {
  /** An image, by URL, with a caption. */
  display: (url, title) => post(`${base}/display`, { url, title }),
  /** A roll as the dice tray made it: { formula, label, groups, flatModifier, total }. */
  dice: (roll) => post(`${base}/dice`, roll),
  clear: () => post(`${base}/clear`, {}),
  chart: (id) => show('chart', { chart_id: id }),
  vista: (id) => show('vista', { vista_id: id }),
  battlemap: (id) => show('battlemap', { battlemap_id: id }),
  /** Any kind the screen draws ("chart", "vista", "constellation"), with the body it takes. */
  show,
  /** Unsaved edits of what is on the screen, mirrored as they are made. */
  live: (kind, payload) => post(`${base}/${kind}/live`, payload)
}
