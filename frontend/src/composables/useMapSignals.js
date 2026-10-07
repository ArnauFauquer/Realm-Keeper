import { onBeforeUnmount } from 'vue'
import { listenToSync } from './syncSocket'
import { useAuth } from './useAuth'
import { battlemapsApi } from '@/api/docs'
import { httpClient } from '@/api/http'
import { encodePath } from '@/utils/paths'
import { createSignalLayer } from '@/utils/mapSignals'

// The pointer is sent a few points at a time, one request after another, at
// most this often: everyone sees it move without a request per mouse move.
const POINTER_INTERVAL_MS = 50
// What one request may carry (backend models/battlemap.py MAX_SIGNAL_POINTS).
const MAX_POINTS = 64

const randomId = () => Math.random().toString(36).slice(2, 10)

/** Sends a signal to everyone on the map (backend routes/battlemaps.py). */
export const sendSignal = (battlemapId, signal) =>
  httpClient.post(`${battlemapsApi.base}/${encodePath(battlemapId)}/signal`, signal)

/** A batch of more points than a request may carry, thinned out evenly (its
 * last point kept: it is where the pointer is). */
export function thin(points, max = MAX_POINTS) {
  if (points.length <= max) return points
  const step = (points.length - 1) / (max - 1)
  return Array.from({ length: max }, (_, i) => points[Math.round(i * step)])
}

/**
 * The signals on one battlemap, as the table's view of it has them: a layer
 * (utils/mapSignals.js) with what everyone else points at, heard on the sync
 * socket, and this tab's own, drawn at once and sent. `ping(point)` pings a
 * point, `point(point)` moves the pointer there (starting a stroke) and
 * `release()` lifts it; `roll(tokenId, { label, formula, total })` shows a
 * roll over a token; `measure({ points, token, end })` shares a ruler or a
 * token's path (the canvas draws this tab's own). Points are in cells.
 * Nothing is sent when `canSend()` says no (signed out).
 */
export function useMapSignals(battlemapId, { canSend = () => true } = {}) {
  const layer = createSignalLayer()
  // This tab: what it sends comes back on the socket, and is already drawn.
  const source = randomId()
  const { user } = useAuth()
  const slot = () => user.value?.diceSlot

  const stop = listenToSync({
    onEvent(event) {
      if (event?.type === 'signal' && event.battlemap === battlemapId && event.source !== source) layer.receive(event)
    },
    onOpen() {}
  })

  function send(signal) {
    if (!canSend()) return Promise.resolve()
    // Best effort: a ping that doesn't arrive is just a ping no one saw.
    return sendSignal(battlemapId, { ...signal, source }).catch(() => {})
  }

  function ping(point) {
    const signal = { kind: 'ping', points: [{ x: point.x, y: point.y }] }
    layer.receive({ ...signal, slot: slot() }, undefined, { local: true })
    send(signal)
  }

  function roll(tokenId, { label = '', formula = '', total }) {
    const signal = { kind: 'roll', token: tokenId, roll: { label: String(label).slice(0, 80), formula: String(formula).slice(0, 200), total } }
    layer.receive({ ...signal, slot: slot() }, undefined, { local: true })
    send(signal)
  }

  // ── the pointer ────────────────────────────────────────────────────────
  let stroke = null // { id, startedAt, queued: [points], ended, sending, timer }

  function point(at) {
    const time = performance.now()
    if (!stroke) stroke = { id: randomId(), startedAt: time, queued: [], ended: false, sending: false, timer: null }
    const p = { x: at.x, y: at.y, t: Math.round(time - stroke.startedAt) }
    layer.receive({ kind: 'pointer', stroke: stroke.id, points: [p], slot: slot() }, undefined, { local: true })
    stroke.queued.push(p)
    schedule(stroke)
  }

  function release() {
    if (!stroke) return
    layer.receive({ kind: 'pointer', stroke: stroke.id, points: [], end: true, slot: slot() }, undefined, { local: true })
    stroke.ended = true
    schedule(stroke)
    stroke = null
  }

  // One request at a time per stroke, in order, each with the points that
  // piled up meanwhile; the last one says the stroke is over.
  function schedule(current) {
    if (current.sending || current.timer) return
    current.timer = setTimeout(() => flush(current), POINTER_INTERVAL_MS)
  }

  async function flush(current) {
    current.timer = null
    if (!current.queued.length && !current.ended) return
    const points = thin(current.queued.splice(0))
    const end = current.ended && !current.queued.length
    current.sending = true
    await send({ kind: 'pointer', stroke: current.id, points, end })
    current.sending = false
    if (end) current.ended = 'sent'
    else if (current.queued.length || current.ended === true) schedule(current)
  }

  // ── measuring ──────────────────────────────────────────────────────────
  // A ruler, or a token's path as it is moved: drawn here by the canvas, and
  // sent whole each time (only the newest path matters), one request after
  // another, the last saying it is over.
  let measurement = null // { id, pending, sending, timer, closed }

  function measure({ points, token = null, end = false }) {
    if (!measurement || measurement.closed) measurement = { id: randomId(), pending: null, sending: false, timer: null, closed: false }
    const current = measurement
    current.pending = { kind: 'ruler', stroke: current.id, points: thin(points.map(({ x, y }) => ({ x, y }))), token, end }
    if (end) current.closed = true
    scheduleMeasure(current)
  }

  function scheduleMeasure(current) {
    if (current.sending || current.timer) return
    current.timer = setTimeout(() => flushMeasure(current), POINTER_INTERVAL_MS)
  }

  async function flushMeasure(current) {
    current.timer = null
    const signal = current.pending
    current.pending = null
    if (!signal) return
    current.sending = true
    await send(signal)
    current.sending = false
    if (current.pending) scheduleMeasure(current)
  }

  onBeforeUnmount(() => {
    if (stroke) clearTimeout(stroke.timer)
    if (measurement) clearTimeout(measurement.timer)
    stop()
  })

  return { layer, ping, point, release, roll, measure }
}
