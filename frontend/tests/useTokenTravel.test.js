// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { TRAVEL_MIN_MS, WAIT_FOR_PATH_MS, pointAlong, useTokenTravel } from '@/composables/useTokenTravel'
import { createSignalLayer } from '@/utils/mapSignals'

let clock = 0
let frames = []
beforeEach(() => {
  clock = 0
  frames = []
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
  vi.stubGlobal('requestAnimationFrame', (fn) => { frames.push(fn); return frames.length })
  vi.stubGlobal('cancelAnimationFrame', () => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

// Moves the clock on and runs the frames that were waiting.
async function advance(ms) {
  clock += ms
  const due = frames
  frames = []
  due.forEach((fn) => fn(clock))
  await nextTick()
}

function setup(tokens, layer = null) {
  let travel
  const list = ref(tokens)
  mount(defineComponent({
    setup() {
      travel = useTokenTravel({ tokens: () => list.value, layer: () => layer })
      return () => h('div')
    }
  }))
  return { list, travel }
}

const ORC = { id: 'orc', x: 0, y: 0, size: 1 }

describe('pointAlong', () => {
  it('walks a path with turns by its length', () => {
    const path = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }]
    expect(pointAlong(path, 0)).toEqual({ x: 0, y: 0 })
    expect(pointAlong(path, 0.25)).toEqual({ x: 1, y: 0 })
    expect(pointAlong(path, 0.75)).toEqual({ x: 2, y: 1 })
    expect(pointAlong(path, 1)).toEqual({ x: 2, y: 2 })
  })
})

describe('useTokenTravel', () => {
  it('sends a token off along the path it was dragged, turns and all, and lands it', async () => {
    const { list, travel } = setup([ORC])
    travel.travel('orc', [{ x: 0.5, y: 0.5 }, { x: 4.5, y: 0.5 }, { x: 4.5, y: 4.5 }])
    expect(travel.centerOf(ORC)).toEqual({ x: 0.5, y: 0.5 })
    await advance(360) // halfway through 8 cells at 90 ms each
    expect(travel.centerOf(ORC)).toEqual({ x: 4.5, y: 0.5 }) // at the turn
    list.value = [{ ...ORC, x: 4, y: 4 }] // the move, agreed: it is already on its way there
    await nextTick()
    await advance(400)
    expect(travel.centerOf(list.value[0])).toBeNull() // arrived: drawn where it is
  })

  it("takes someone else's move along the path they moved it along", async () => {
    const layer = createSignalLayer()
    const { list, travel } = setup([ORC], layer)
    layer.receive({ kind: 'ruler', stroke: 's', token: 'orc', end: true, points: [{ x: 0.5, y: 0.5 }, { x: 0.5, y: 3.5 }, { x: 2.5, y: 3.5 }] }, clock)
    list.value = [{ ...ORC, x: 2, y: 3 }]
    await nextTick()
    expect(travel.centerOf(list.value[0])).toEqual({ x: 0.5, y: 0.5 }) // waiting at the start
    await advance(1)
    await advance(TRAVEL_MIN_MS * 0.5)
    expect(travel.centerOf(list.value[0]).x).toBe(0.5) // still on the first leg, straight down
    expect(travel.centerOf(list.value[0]).y).toBeGreaterThan(0.5)
  })

  it('goes straight when no path comes', async () => {
    const { list, travel } = setup([ORC])
    list.value = [{ ...ORC, x: 4, y: 0 }]
    await nextTick()
    expect(travel.centerOf(list.value[0])).toEqual({ x: 0.5, y: 0.5 })
    await advance(WAIT_FOR_PATH_MS)
    await advance(TRAVEL_MIN_MS / 2)
    const halfway = travel.centerOf(list.value[0])
    expect(halfway.y).toBe(0.5)
    expect(halfway.x).toBeGreaterThan(0.5)
    expect(halfway.x).toBeLessThan(4.5)
  })

  it('leaves alone a token seen for the first time, or not moved', async () => {
    const { list, travel } = setup([ORC])
    list.value = [ORC, { id: 'new', x: 5, y: 5 }]
    await nextTick()
    expect(travel.centerOf(list.value[1])).toBeNull()
    expect(travel.centerOf(ORC)).toBeNull()
  })

  it('does not move anything on its way with reduced motion', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    window.matchMedia = () => ({ matches: true })
    const { list, travel } = setup([ORC])
    travel.travel('orc', [{ x: 0.5, y: 0.5 }, { x: 3.5, y: 0.5 }])
    list.value = [{ ...ORC, x: 3 }]
    await nextTick()
    expect(travel.centerOf(list.value[0])).toBeNull()
    delete window.matchMedia
  })
})
