import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import { MAX_DICE } from '@/utils/diceNotation'

// Face textures are drawn on a 2D canvas, which a test runner doesn't have:
// plain materials stand in, counted so a test can see how many were built.
const built = { materials: 0 }
vi.mock('@/dice/diceTextures', () => ({
  buildFaceMaterials: (labels) => labels.map(() => {
    built.materials++
    return new THREE.MeshBasicMaterial()
  })
}))

const { replayGroups } = await import('@/dice/diceRoller')
const { createAssetCache, themeKey } = await import('@/dice/diceAssets')

// The parts of diceWorld.js a replay uses, without a renderer.
function fakeWorld() {
  const dice = []
  return {
    dice,
    trayHalf: { x: 5, z: 5 },
    assets: createAssetCache(),
    addDie: (mesh, body) => dice.push({ mesh, body }),
    stepAndRender: vi.fn(),
    syncMeshes: vi.fn(),
    render: vi.fn()
  }
}

beforeEach(() => {
  built.materials = 0
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function replay(world, groups, options) {
  const done = replayGroups(world, groups, undefined, { tumbleMs: 100, ...options })
  await vi.advanceTimersByTimeAsync(1000)
  await done
}

describe('replayGroups', () => {
  it('throws one die per roll and snaps each to its value', async () => {
    const world = fakeWorld()
    await replay(world, [{ sides: 6, sign: 1, rolls: [3, 5] }, { sides: 100, sign: 1, rolls: [42] }])
    expect(world.dice).toHaveLength(4)
    expect(world.dice.every(({ body }) => body.sleepState === CANNON.Body.SLEEPING)).toBe(true)
    expect(world.render).toHaveBeenCalled()
  })

  it('never throws more than MAX_DICE dice', async () => {
    const world = fakeWorld()
    const rolls = Array.from({ length: MAX_DICE + 30 }, () => 1)
    await replay(world, [{ sides: 20, sign: 1, rolls }, { sides: 100, sign: 1, rolls: [50] }])
    expect(world.dice).toHaveLength(MAX_DICE)
  })

  it('skips dice of an unsupported size instead of failing halfway', async () => {
    const world = fakeWorld()
    await replay(world, [
      { sides: 6, sign: 1, rolls: [2] },
      { sides: 7, sign: 1, rolls: [4] },
      { sides: '20', sign: 1, rolls: [4] },
      { sides: 8, sign: 1 },
      { sides: 8, sign: 1, rolls: [8] }
    ])
    expect(world.dice).toHaveLength(2)
  })

  it('shares one geometry and one set of face materials per kind of die', async () => {
    const world = fakeWorld()
    await replay(world, [{ sides: 20, sign: 1, rolls: Array.from({ length: 30 }, () => 7) }])
    const [first, ...rest] = world.dice
    expect(rest.every(({ mesh }) => mesh.geometry === first.mesh.geometry && mesh.material === first.mesh.material)).toBe(true)
    // One material per face of a d20, not one per face per die.
    expect(built.materials).toBe(20)
  })

  it('stops tumbling as soon as it is aborted, without snapping the dice', async () => {
    let frame = null
    vi.stubGlobal('requestAnimationFrame', (fn) => { frame = fn; return 1 })
    vi.stubGlobal('cancelAnimationFrame', () => { frame = null })
    const world = fakeWorld()
    const controller = new AbortController()
    const done = replayGroups(world, [{ sides: 6, sign: 1, rolls: [3] }], undefined, { tumbleMs: 1000, signal: controller.signal })
    controller.abort()
    await done
    const steps = world.stepAndRender.mock.calls.length
    await vi.advanceTimersByTimeAsync(2000)
    frame?.()
    expect(world.stepAndRender.mock.calls.length).toBe(steps)
    expect(world.render).not.toHaveBeenCalled()
    expect(world.dice[0].body.sleepState).not.toBe(CANNON.Body.SLEEPING)
  })
})

describe('createAssetCache', () => {
  it('builds a value once per key and frees everything on dispose', () => {
    const cache = createAssetCache()
    const material = new THREE.MeshBasicMaterial({ map: new THREE.Texture() })
    const geometry = new THREE.BufferGeometry()
    const disposed = vi.fn()
    material.addEventListener('dispose', disposed)
    material.map.addEventListener('dispose', disposed)
    geometry.addEventListener('dispose', disposed)
    const create = vi.fn(() => [material])
    expect(cache.get('faces', create)).toBe(cache.get('faces', create))
    expect(create).toHaveBeenCalledTimes(1)
    cache.get('die', () => ({ geometry, faceTable: [] }))
    cache.dispose()
    expect(disposed).toHaveBeenCalledTimes(3)
    expect(cache.size).toBe(0)
  })

  it('tells themes apart by their colours', () => {
    expect(themeKey({ bg: '#000', fg: '#fff', accent: 'red' })).not.toBe(themeKey({ bg: '#111', fg: '#fff', accent: 'red' }))
    expect(themeKey(undefined)).toBe('default')
  })
})
