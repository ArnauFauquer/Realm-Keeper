// What /screen shows, as one value: the scene (an image, a chart, a vista, a
// battlemap, the constellation, or nothing) and what it needs to draw it.
// Every /ws/screen message goes through reduceScene, so one scene replaces
// the last whole - there is no "clear every other kind" to forget, and a
// caption can't linger over a chart.
//
// A chart or vista is fetched after its message arrives. `seq` counts the
// scenes: a fetch carries the seq it was started for, and its result is only
// taken while that scene is still the one showing. Sending chart A then chart
// B (or then an image) can't let A's slower fetch land last.

export const EMPTY_SCENE = Object.freeze({
  kind: 'none', // 'none' | 'media' | 'chart' | 'vista' | 'battlemap' | 'constellation'
  seq: 0,
  // media: the image and its caption
  url: '',
  title: '',
  // chart / vista: the id asked for, the document showing, whether the asked
  // one is still being fetched; battlemap: its id
  id: null,
  doc: null,
  loading: false,
  // battlemap: the map as the server projected it for a screen
  battlemap: null,
  // constellation: layout, pan/zoom, highlights
  constellation: null,
  // A live edit that arrived while its chart/vista was still being fetched
  // (a screen connecting mid-edit gets both back to back): { kind, edit }.
  pendingLiveEdit: null
})

// The message minus its `type`.
function body(message) {
  const { type, ...rest } = message
  return rest
}

function scene(state, kind, fields = {}) {
  return { ...EMPTY_SCENE, seq: state.seq + 1, kind, ...fields }
}

function showDocument(state, kind, id) {
  if (!id) return scene(state, 'none')
  // Another chart while a chart is showing: the one on screen stays until
  // the new one has loaded, instead of blinking through the waiting state.
  return scene(state, kind, { id, doc: state.kind === kind ? state.doc : null, loading: true })
}

// The GM's unsaved edits to the chart/vista on screen. `type` and the id are
// only for matching; everything else is the document.
function applyLiveEdit(state, kind, message) {
  const edit = body(message)
  const id = edit[`${kind}_id`]
  if (state.kind === kind && !state.loading && state.doc?.id === id) {
    return { ...state, doc: { ...state.doc, ...edit } }
  }
  return { ...state, pendingLiveEdit: { kind, edit } }
}

function takeLoaded(state, doc) {
  const pending = state.pendingLiveEdit
  const matches = pending?.kind === state.kind && pending.edit[`${state.kind}_id`] === doc.id
  return {
    ...state,
    doc: matches ? { ...doc, ...pending.edit } : doc,
    loading: false,
    pendingLiveEdit: matches ? null : pending
  }
}

/**
 * The scene after a /ws/screen message, or after one of the two the screen
 * makes itself once a fetch settles: { type: 'scene_loaded', seq, doc } and
 * { type: 'scene_failed', seq }. Messages that aren't about the scene (a dice
 * roll) leave it as it is. Never mutates `state`.
 */
export function reduceScene(state, message) {
  switch (message?.type) {
    case 'display_media':
      // Nothing to show: an image already up stays, anything else goes.
      if (!message.url) return state.kind === 'media' ? state : scene(state, 'none')
      return scene(state, 'media', { url: message.url, title: message.title || '' })
    case 'display_chart':
      return showDocument(state, 'chart', message.chart_id)
    case 'display_vista':
      return showDocument(state, 'vista', message.vista_id)
    case 'display_constellation':
      return scene(state, 'constellation', { constellation: body(message) })
    case 'display_battlemap':
      // The map itself comes with the update_battlemap sent right after.
      return scene(state, 'battlemap', { id: message.battlemap_id })
    case 'update_battlemap':
      // The whole map as it is now: sent after the pointer, and after every change.
      if (state.kind !== 'battlemap' || message.battlemap_id !== state.id) return state
      return { ...state, battlemap: body(message) }
    case 'update_constellation':
      // Only for the constellation already showing.
      if (state.kind !== 'constellation') return state
      return { ...state, constellation: body(message) }
    case 'update_chart':
      return applyLiveEdit(state, 'chart', message)
    case 'update_vista':
      return applyLiveEdit(state, 'vista', message)
    case 'clear_screen':
      return scene(state, 'none')
    case 'scene_loaded':
      if (message.seq !== state.seq) return state
      return takeLoaded(state, message.doc)
    case 'scene_failed':
      if (message.seq !== state.seq) return state
      return { ...state, doc: null, loading: false }
    default:
      return state
  }
}

/** Whether a message puts a new scene up (and so takes down a dice roll
 * showing over the old one). */
export function changesScene(message) {
  return ['display_media', 'display_chart', 'display_vista', 'display_constellation', 'display_battlemap', 'clear_screen']
    .includes(message?.type)
}

/** A media URL the backend built for itself (http://localhost:8000/...),
 * pointed at the address this screen reached the app on, with the same port:
 * a TV on the LAN can't reach the backend's "localhost". */
export function screenMediaUrl(url, hostname) {
  if (!url || !url.includes('localhost:') || hostname === 'localhost') return url
  const parts = url.split('/')
  const port = parts[2]?.split(':')[1] || '8000'
  parts[2] = `${hostname}:${port}`
  return parts.join('/')
}
