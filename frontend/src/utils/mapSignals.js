// What is pointed at on a battlemap for a moment: a ping at a point, the laser
// pointer's trail, a roll shown over a token (backend models/battlemap.py
// MapSignal). Nothing of it is kept in the map; each view of the map (the
// table's, the screen's) holds the signals it was sent in a layer like this
// one, which forgets them as they fade. Points are in cells, like tokens.
import { signalColorForSlot } from '@/dice/diceTheme'

/** How long a ping shows, in ms. */
export const PING_MS = 1800
/** How long the pointer's trail lingers behind it. */
export const TRAIL_MS = 700
/** How long a roll stays over its token. */
export const ROLL_MS = 5000
/** A stroke that stops arriving without its end (the sender's tab closed) is
 * let go of after this. */
export const STROKE_IDLE_MS = 2500
/** Someone else's pointer is replayed this far behind, so the points of a
 * batch are spread out as they were drawn instead of all landing at once. */
export const REPLAY_DELAY_MS = 120

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

/**
 * A layer of signals. `receive(signal, at, { local })` takes one as the server
 * sends it ({ kind, points, stroke, end, token, roll, by, slot, source });
 * `local` ones are this tab's own, drawn without the replay delay. `view(at)`
 * is what to draw at that moment; `prune(at)` forgets what has faded, and
 * `idle()` says when there is nothing left to draw. `subscribe(fn)` is told
 * of every signal received.
 */
export function createSignalLayer() {
  let pings = []
  const strokes = new Map()
  const rolls = new Map() // by token: one roll over it at a time, the newest
  const listeners = new Set()
  let seq = 0

  function receive(signal, at = now(), { local = false } = {}) {
    const color = signalColorForSlot(signal.slot)
    const by = local ? null : signal.by || null
    if (signal.kind === 'ping') {
      const [point] = signal.points || []
      if (!point) return
      pings.push({ id: ++seq, x: point.x, y: point.y, color, by, at })
    } else if (signal.kind === 'pointer') {
      receivePointer(signal, at, { color, by, local })
    } else if (signal.kind === 'roll' && signal.token && signal.roll) {
      rolls.set(signal.token, { id: ++seq, token: signal.token, ...signal.roll, color, by, at })
    } else {
      return
    }
    listeners.forEach((listener) => listener())
  }

  function receivePointer(signal, at, { color, by, local }) {
    const key = `${signal.source || ''}|${signal.by || ''}|${signal.stroke}`
    const points = signal.points || []
    const lastT = points.length ? points[points.length - 1].t || 0 : 0
    let stroke = strokes.get(key)
    if (!stroke) {
      stroke = { key, color, by, points: [], ended: false, lastAt: at, base: at - lastT + (local ? 0 : REPLAY_DELAY_MS) }
      strokes.set(key, stroke)
    }
    // Arriving later than its points were due (the network stalled): from
    // here on it is shown as it comes, rather than ever further behind.
    if (stroke.base + lastT < at) stroke.base = at - lastT
    for (const point of points) stroke.points.push({ x: point.x, y: point.y, at: stroke.base + (point.t || 0) })
    stroke.lastAt = at
    if (signal.end) stroke.ended = true
  }

  function view(at = now()) {
    return {
      pings: pings
        .filter((ping) => at - ping.at < PING_MS)
        .map((ping) => ({ ...ping, progress: Math.max(0, (at - ping.at) / PING_MS) })),
      strokes: [...strokes.values()].map((stroke) => strokeView(stroke, at)).filter(Boolean),
      rolls: [...rolls.values()]
        .filter((roll) => at - roll.at < ROLL_MS)
        .map((roll) => ({ ...roll, progress: Math.max(0, (at - roll.at) / ROLL_MS) }))
    }
  }

  // The trail: each piece fades with the age of the point it ends at. The
  // head (where the pointer is) shows while the stroke goes on.
  function strokeView(stroke, at) {
    const due = stroke.points.filter((point) => point.at <= at)
    if (!due.length) return null
    // Still pointing (or still being replayed): the head stays where the
    // pointer is, however long it rests there.
    const active = !stroke.ended || due.length < stroke.points.length
    const trail = due.filter((point) => at - point.at <= TRAIL_MS)
    if (!active && !trail.length) return null
    const segments = []
    for (let i = 1; i < trail.length; i++) {
      const [from, to] = [trail[i - 1], trail[i]]
      segments.push({ x1: from.x, y1: from.y, x2: to.x, y2: to.y, opacity: 1 - (at - to.at) / TRAIL_MS })
    }
    const last = due[due.length - 1]
    return { key: stroke.key, color: stroke.color, by: stroke.by, segments, head: active ? { x: last.x, y: last.y } : null }
  }

  function prune(at = now()) {
    pings = pings.filter((ping) => at - ping.at < PING_MS)
    for (const [token, roll] of rolls) if (at - roll.at >= ROLL_MS) rolls.delete(token)
    for (const [key, stroke] of strokes) {
      // The head stays where the pointer rests: only points behind it fade out.
      const lastPoint = stroke.points[stroke.points.length - 1]
      stroke.points = stroke.points.filter((point) => at - point.at <= TRAIL_MS || point === lastPoint)
      const faded = !lastPoint || at - lastPoint.at > TRAIL_MS
      if (faded && (stroke.ended || at - stroke.lastAt > STROKE_IDLE_MS)) strokes.delete(key)
    }
  }

  const idle = () => !pings.length && !strokes.size && !rolls.size

  function clear() {
    pings = []
    strokes.clear()
    rolls.clear()
  }

  function subscribe(listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  return { receive, view, prune, idle, clear, subscribe }
}
