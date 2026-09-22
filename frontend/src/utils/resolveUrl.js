import { apiUrl } from '@/config/env'

// Backend-relative asset URLs (vista backgrounds, chart images, pin icons —
// all asset library entries) come back as paths like "/api/asset-library/assets/...". Absolute
// URLs (e.g. an external image) are left untouched.
export function resolveUrl(url) {
  if (!url) return url
  return url.startsWith('http') ? url : `${apiUrl}${url}`
}

// Same as resolveUrl, but for text meant to be copied out of the app (e.g. a
// markdown image tag pasted into a note or shared elsewhere) rather than
// used in a same-page :src binding. apiUrl is deliberately empty in the
// same-origin nginx setup (see .env), which resolveUrl's bare relative path
// only works for because the browser fills in the current page's origin —
// copied text has no such context, so this always includes a real host.
export function absoluteUrl(url) {
  if (!url) return url
  if (url.startsWith('http')) return url
  const base = apiUrl || (typeof window !== 'undefined' ? window.location.origin : '')
  return `${base}${url}`
}
