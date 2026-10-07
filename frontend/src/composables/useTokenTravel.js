import { onBeforeUnmount, ref, watch } from 'vue'

// A moved token travels to where it went, briefly, along the path it was
// moved along (where it started, each turn, where it ended), on every view of
// the map: the one that moved it, everyone else's, the screen.
//
// Speed follows the path's length, within bounds, so a step is quick and a
// long run still short.
export const TRAVEL_MS_PER_CELL = 90
export const TRAVEL_MIN_MS = 250
export const TRAVEL_MAX_MS = 900
// Someone else's move can arrive before the path they moved along: it waits
// this long for it, then goes straight.
export const WAIT_FOR_PATH_MS = 200
// A path heard this long before the move is someone's older one.
const PATH_FRESH_MS = 3000

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2)
const near = (a, b) => Math.abs(a.x - b.x) < 0.02 && Math.abs(a.y - b.y) < 0.02

function lengthOf(points) {
  let total = 0
  for (let i = 1; i < points.length; i++) total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
  return total
}

/** Where along a path (points in cells) a fraction of its length lands. */
export function pointAlong(points, fraction) {
  if (points.length === 1 || fraction <= 0) return points[0]
  const total = lengthOf(points)
  if (!total || fraction >= 1) return points[points.length - 1]
  let left = total * fraction
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]]
    const leg = Math.hypot(b.x - a.x, b.y - a.y)
    if (left <= leg) {
      const t = leg ? left / leg : 0
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
    }
    left -= leg
  }
  return points[points.length - 1]
}

const travelTime = (points) => Math.min(TRAVEL_MAX_MS, Math.max(TRAVEL_MIN_MS, lengthOf(points) * TRAVEL_MS_PER_CELL))

/**
 * `tokens()` is the map's tokens; `layer()` its signal layer (or nothing),
 * where the paths others move tokens along are heard. `centerOf(token)` is
 * where to draw a token's centre (in cells) while it travels, or null when it
 * is where it is; `travel(id, path)` sets one off along a path this view
 * knows (its own drop). With reduced motion, tokens simply are where they go.
 */
export function useTokenTravel({ tokens, layer = () => null }) {
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const frame = ref(0) // ticks while anything travels, so centres follow
  const travels = new Map() // id -> { points, start, duration }
  const waiting = new Map() // id -> { from, to, since }
  let last = new Map() // id -> centre (cells) as last seen
  let raf = null

  const centre = (token) => ({ x: token.x + (token.size ?? 1) / 2, y: token.y + (token.size ?? 1) / 2 })

  function tick() {
    const at = now()
    for (const [id, wait] of waiting) {
      const path = layer()?.pathFor?.(id, wait.since - PATH_FRESH_MS)
      if (path && path.length > 1 && near(path[path.length - 1], wait.to)) start(id, path, at)
      else if (at - wait.since >= WAIT_FOR_PATH_MS) start(id, [wait.from, wait.to], at)
    }
    for (const [id, travel] of travels) if (at - travel.start >= travel.duration) travels.delete(id)
    frame.value++
    raf = travels.size || waiting.size ? requestAnimationFrame(tick) : null
  }

  const wake = () => { if (raf === null && typeof requestAnimationFrame !== 'undefined') raf = requestAnimationFrame(tick) }

  function start(id, points, at = now()) {
    waiting.delete(id)
    travels.set(id, { points, start: at, duration: travelTime(points) })
  }

  /** Sets a token off along `path` (cells: its centre at the start, each turn, the end). */
  function travel(id, path) {
    if (reduced || path.length < 2) return
    start(id, path)
    wake()
  }

  // A token whose place changed travels there: along the path that took it
  // there if this view knows it (its own, or one heard), or straight.
  watch(() => (tokens() || []).map((t) => `${t.id}:${t.x}:${t.y}:${t.size ?? 1}`).join('|'), () => {
    const next = new Map((tokens() || []).map((t) => [t.id, centre(t)]))
    if (!reduced) {
      for (const [id, to] of next) {
        const from = last.get(id)
        if (!from || near(from, to)) continue
        const going = travels.get(id)
        if (going && near(going.points[going.points.length - 1], to)) continue // already on its way there
        waiting.set(id, { from: going ? currentOf(id, going) : from, to, since: now() })
      }
      for (const id of [...travels.keys(), ...waiting.keys()]) if (!next.has(id)) { travels.delete(id); waiting.delete(id) }
      if (waiting.size) wake()
    }
    last = next
  }, { immediate: true })

  function currentOf(id, travel, at = now()) {
    return pointAlong(travel.points, ease(Math.min(1, (at - travel.start) / travel.duration)))
  }

  /** Where to draw a token's centre (cells) right now, or null: where it is. */
  function centerOf(token) {
    void frame.value // follow the ticks
    const wait = waiting.get(token.id)
    if (wait) return wait.from
    const going = travels.get(token.id)
    return going ? currentOf(token.id, going) : null
  }

  onBeforeUnmount(() => { if (raf !== null) cancelAnimationFrame(raf) })

  return { centerOf, travel }
}
