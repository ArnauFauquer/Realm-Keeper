// Note ids, document ids, folder paths and track keys can be several segments
// deep ("goblins/cave-ambush"). In a URL each segment is encoded on its own, so
// the "/" stays a path separator instead of being escaped to %2F.

/** "act 2/la entrada" -> "act%202/la%20entrada". */
export function encodePath(path) {
  return path.split('/').map(encodeURIComponent).join('/')
}

/** The app's page of a note (a router path). */
export const noteRoute = (id) => `/note/${encodePath(id)}`

/** A note as the API serves it, rendered; prefix it with `apiUrl`. */
export const noteApi = (id) => `/api/note/${encodePath(id)}`

/** A note's Markdown as the API serves it, for the editor; prefix it with `apiUrl`. */
export const noteRawApi = (id) => `/api/note-raw/${encodePath(id)}`

/**
 * The note id a `/note/...` href points to (decoded, as the backend writes
 * wikilinks: each segment encoded), or null for any other href. A segment
 * that isn't valid percent-encoding is kept as written.
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

/** A folder inside another, or at the top when there is none: ("act 2", "caves") -> "act 2/caves". */
export const joinPath = (parent, name) => (parent ? `${parent}/${name}` : name)
