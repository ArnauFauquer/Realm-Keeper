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
