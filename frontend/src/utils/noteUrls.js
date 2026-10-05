import { apiUrl } from '@/config/env'

// A note's id is its path in the vault without `.md` ("Places/La Ciénaga"),
// and names may hold anything a file name can: spaces, accents, `#`, `%`,
// `?`. Every link to a note and every request for one is built here, the same
// way the backend writes [[wikilinks]] (each segment encoded, the slashes
// kept), so the router sees one URL per note and the request cache one key.

/** "Places/C# notes" -> "Places/C%23%20notes". */
export function encodePath(path) {
  return String(path ?? '').split('/').map(encodeURIComponent).join('/')
}

/** The app route of a note. */
export function noteRoute(id) {
  return '/note/' + encodePath(id)
}

/** The rendered note (GET) and the save (PUT). */
export function noteApi(id) {
  return `${apiUrl}/api/note/${encodePath(id)}`
}

/** The note's file as written, for the editor. */
export function noteRawApi(id) {
  return `${apiUrl}/api/note-raw/${encodePath(id)}`
}

/**
 * The note id a `/note/...` href points to (decoded), or null for any other
 * href. A segment that isn't valid percent-encoding is kept as written.
 */
export function noteIdFromHref(href) {
  const match = /^\/note\/([^?#]*)/.exec(href || '')
  if (!match) return null
  return match[1].split('/').map((segment) => {
    try {
      return decodeURIComponent(segment)
    } catch {
      return segment
    }
  }).join('/')
}
