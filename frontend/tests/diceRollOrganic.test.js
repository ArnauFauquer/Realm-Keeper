// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import * as CANNON from 'cannon-es'

vi.mock('@/dice/diceTextures', () => ({
  buildFaceMaterials: (labels) => labels.map(() => new THREE.MeshBasicMaterial())
}))

const { rollParsedFormula } = await import('@/dice/diceRoller')
const { createAssetCache } = await import('@/dice/diceAssets')
const { parseDiceFormula } = await import('@/utils/diceNotation')

// A real physics world with a floor, stepped by a timer instead of a renderer.
function physicsWorld() {
  const physics = new CANNON.World({ gravity: new CANNON.Vec3(0, -26, 0) })
  physics.allowSleep = true
  const floor = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() })
  floor.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2)
  physics.addBody(floor)
  let timer = null
  return {
    world: physics,
    trayHalf: { x: 5, z: 5 },
    assets: createAssetCache(),
    addDie: (mesh, body) => physics.addBody(body),
    start: vi.fn(() => { timer ??= setInterval(() => physics.step(1 / 60, 1 / 60, 6), 16) }),
    syncMeshes: vi.fn(),
    render: vi.fn()
  }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

async function roll(formula) {
  const world = physicsWorld()
  const done = rollParsedFormula(world, parseDiceFormula(formula))
  await vi.advanceTimersByTimeAsync(20000)
  return { result: await done, world }
}

describe('rollParsedFormula', () => {
  it('throws the dice, waits for them to land and reads every face', async () => {
    const { result, world } = await roll('3d6+2')
    expect(world.start).toHaveBeenCalled()
    const [rolls] = result.groups.map((g) => g.rolls)
    expect(rolls).toHaveLength(3)
    rolls.forEach((v) => { expect(v).toBeGreaterThanOrEqual(1); expect(v).toBeLessThanOrEqual(6) })
    expect(result.total).toBe(rolls.reduce((a, b) => a + b, 0) + 2)
    expect(result.flatModifier).toBe(2)
  })

  it('rolls a percentile as a tens die and a units die', async () => {
    const { result } = await roll('d100')
    const [value] = result.groups[0].rolls
    expect(value).toBeGreaterThanOrEqual(1)
    expect(value).toBeLessThanOrEqual(100)
    expect(result.total).toBe(value)
  })

  it('rolls several kinds of die in one formula', async () => {
    const { result } = await roll('d20+d4')
    expect(result.groups.map((g) => g.sides)).toEqual([20, 4])
  })
})
