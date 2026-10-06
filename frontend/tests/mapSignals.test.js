import { describe, expect, it } from 'vitest'
import { PING_MS, REPLAY_DELAY_MS, ROLL_MS, STROKE_IDLE_MS, TRAIL_MS, createSignalLayer } from '@/utils/mapSignals'
import { PLAYER_SIGNAL_COLORS } from '@/dice/diceTheme'

const ping = (x, y, extra = {}) => ({ kind: 'ping', points: [{ x, y }], by: 'Mia', slot: 1, ...extra })
const pointer = (points, extra = {}) => ({ kind: 'pointer', stroke: 's1', source: 'tab', by: 'Mia', slot: 2, points, ...extra })

describe('a signal layer', () => {
  it('shows a ping where it was sent, in its sender\'s colour, until it fades', () => {
    const layer = createSignalLayer()
    layer.receive(ping(3, 4), 1000)
    const [shown] = layer.view(1000 + PING_MS / 2).pings
    expect(shown).toMatchObject({ x: 3, y: 4, by: 'Mia', color: PLAYER_SIGNAL_COLORS[1], progress: 0.5 })
    expect(layer.view(1000 + PING_MS).pings).toEqual([])
    layer.prune(1000 + PING_MS)
    expect(layer.idle()).toBe(true)
  })

  it('names nobody over this tab\'s own signals', () => {
    const layer = createSignalLayer()
    layer.receive(ping(1, 1), 0, { local: true })
    expect(layer.view(10).pings[0].by).toBeNull()
  })

  it('replays someone else\'s pointer at the pace it was drawn, a moment behind', () => {
    const layer = createSignalLayer()
    // A batch of three points drawn over 40 ms arrives at once.
    layer.receive(pointer([{ x: 0, y: 0, t: 0 }, { x: 1, y: 0, t: 20 }, { x: 2, y: 0, t: 40 }]), 1000)
    const due = 1000 + REPLAY_DELAY_MS // when its last point is shown
    expect(layer.view(due - 41).strokes).toEqual([])
    expect(layer.view(due - 40).strokes[0].head).toEqual({ x: 0, y: 0 })
    expect(layer.view(due - 20).strokes[0].head).toEqual({ x: 1, y: 0 })
    const now = layer.view(due).strokes[0]
    expect(now.head).toEqual({ x: 2, y: 0 })
    expect(now.segments).toHaveLength(2)
    expect(now.segments[1].opacity).toBe(1)
    expect(now.segments[0].opacity).toBeLessThan(1) // older: fading
    expect(now).toMatchObject({ by: 'Mia', color: PLAYER_SIGNAL_COLORS[2] })
  })

  it('keeps the head where the pointer rests, and lets the trail go once it is lifted', () => {
    const layer = createSignalLayer()
    layer.receive(pointer([{ x: 0, y: 0, t: 0 }, { x: 1, y: 0, t: 10 }]), 0, { local: true })
    const later = 10 + TRAIL_MS * 3
    layer.prune(later)
    const resting = layer.view(later).strokes[0]
    expect(resting.head).toEqual({ x: 1, y: 0 })
    expect(resting.segments).toEqual([]) // the trail behind it has faded

    layer.receive(pointer([], { end: true }), later, { local: true })
    expect(layer.view(later + 1).strokes).toEqual([])
    layer.prune(later + 1)
    expect(layer.idle()).toBe(true)
  })

  it('lets go of a stroke whose end never came', () => {
    const layer = createSignalLayer()
    layer.receive(pointer([{ x: 0, y: 0, t: 0 }]), 0)
    layer.prune(STROKE_IDLE_MS / 2)
    expect(layer.idle()).toBe(false)
    layer.prune(STROKE_IDLE_MS + REPLAY_DELAY_MS + 1)
    expect(layer.idle()).toBe(true)
  })

  it('does not fall ever further behind a pointer whose points arrive late', () => {
    const layer = createSignalLayer()
    layer.receive(pointer([{ x: 0, y: 0, t: 0 }]), 0)
    // The next batch, drawn 50 ms in, only arrives 2 s later.
    layer.receive(pointer([{ x: 5, y: 5, t: 50 }]), 2000)
    expect(layer.view(2000).strokes[0].head).toEqual({ x: 5, y: 5 })
  })

  it('tells two pointers apart, by tab and stroke', () => {
    const layer = createSignalLayer()
    layer.receive(pointer([{ x: 0, y: 0, t: 0 }]), 0, { local: true })
    layer.receive(pointer([{ x: 9, y: 9, t: 0 }], { source: 'other' }), 0, { local: true })
    expect(layer.view(1).strokes.map((s) => s.head)).toEqual([{ x: 0, y: 0 }, { x: 9, y: 9 }])
  })

  it('shows one roll over a token at a time, the newest, for a few seconds', () => {
    const layer = createSignalLayer()
    layer.receive({ kind: 'roll', token: 'orc', roll: { label: 'Bite', formula: '1d6', total: 4 } }, 0)
    layer.receive({ kind: 'roll', token: 'orc', roll: { label: 'Claw', formula: '1d8', total: 7 } }, 100)
    const rolls = layer.view(200).rolls
    expect(rolls).toHaveLength(1)
    expect(rolls[0]).toMatchObject({ token: 'orc', label: 'Claw', total: 7 })
    expect(layer.view(100 + ROLL_MS).rolls).toEqual([])
  })

  it('ignores what it does not know, and tells its listeners of the rest', () => {
    const layer = createSignalLayer()
    let heard = 0
    const stop = layer.subscribe(() => heard++)
    layer.receive({ kind: 'draw', points: [{ x: 0, y: 0 }] }, 0)
    layer.receive({ kind: 'ping', points: [] }, 0)
    expect(layer.idle()).toBe(true)
    layer.receive(ping(0, 0), 0)
    expect(heard).toBe(1)
    stop()
    layer.receive(ping(0, 0), 0)
    expect(heard).toBe(1)
    layer.clear()
    expect(layer.idle()).toBe(true)
  })
})
