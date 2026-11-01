// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import * as CANNON from 'cannon-es'

// No GPU in a test runner: the renderer is a recorder.
const r = vi.hoisted(() => ({ made: null }))
vi.mock('three', async (orig) => {
  const real = await orig()
  class FakeRenderer {
    constructor() {
      this.ratio = 1
      this.render = vi.fn()
      this.dispose = vi.fn()
      this.setSize = vi.fn()
      r.made = this
    }
    setPixelRatio(v) { this.ratio = v }
    getPixelRatio() { return this.ratio }
  }
  return { ...real, WebGLRenderer: FakeRenderer }
})

const { createDiceWorld } = await import('@/dice/diceWorld')

let canvas, mq, raf, cancel
beforeEach(() => {
  canvas = document.createElement('canvas')
  mq = { listeners: [], addEventListener(_, f) { this.listeners.push(f) }, removeEventListener: vi.fn() }
  window.matchMedia = vi.fn(() => mq)
  raf = vi.fn(() => 5)
  cancel = vi.fn()
  vi.stubGlobal('requestAnimationFrame', raf)
  vi.stubGlobal('cancelAnimationFrame', cancel)
})
afterEach(() => vi.unstubAllGlobals())

const die = () => ({
  mesh: new THREE.Mesh(),
  body: new CANNON.Body({ mass: 1, shape: new CANNON.Sphere(0.5), position: new CANNON.Vec3(0, 3, 0) })
})

describe('createDiceWorld', () => {
  it('starts with a square tray, lit, with a floor and four walls', () => {
    const w = createDiceWorld(canvas)
    expect(w.trayHalf.x).toBe(w.trayHalf.z)
    expect(w.world.bodies).toHaveLength(5)
    expect(w.scene.children.length).toBeGreaterThanOrEqual(3)
    w.dispose()
  })

  it('stretches the tray along the longer side of the screen, up to a cap', () => {
    const w = createDiceWorld(canvas)
    w.resize(1600, 800)
    expect(w.trayHalf.x).toBeCloseTo(w.trayHalf.z * 2)
    w.resize(4000, 400)
    expect(w.trayHalf.x / w.trayHalf.z).toBeCloseTo(2.2)
    w.resize(400, 800)   // portrait: taller than wide, and a little narrower
    expect(w.trayHalf.z).toBeGreaterThan(w.trayHalf.x)
    expect(r.made.setSize).toHaveBeenLastCalledWith(400, 800, false)
    w.dispose()
  })

  it('ignores a resize to nothing', () => {
    const w = createDiceWorld(canvas)
    w.resize(0, 300)
    expect(r.made.setSize).not.toHaveBeenCalled()
    w.dispose()
  })

  it('moves the walls with the tray', () => {
    const w = createDiceWorld(canvas)
    w.resize(1600, 800)
    const xs = w.world.bodies.slice(1).map((b) => Math.abs(b.position.x)).filter(Boolean)
    expect(xs).toEqual([w.trayHalf.x, w.trayHalf.x])
    w.dispose()
  })

  it('drops a die under gravity and keeps its mesh on its body', () => {
    const w = createDiceWorld(canvas)
    const { mesh, body } = die()
    w.addDie(mesh, body)
    expect(w.scene.children).toContain(mesh)
    for (let i = 0; i < 30; i++) w.stepAndRender(1 / 60)
    expect(body.position.y).toBeLessThan(3)
    expect(mesh.position.y).toBe(body.position.y)
    expect(r.made.render).toHaveBeenCalledTimes(30)
    w.dispose()
  })

  it('clears its dice without touching the tray', () => {
    const w = createDiceWorld(canvas)
    const { mesh, body } = die()
    w.addDie(mesh, body)
    w.clearDice()
    expect(w.scene.children).not.toContain(mesh)
    expect(w.world.bodies).toHaveLength(5)
    w.dispose()
  })

  it('runs its frame loop once, and stops it', () => {
    const w = createDiceWorld(canvas)
    w.start()
    w.start()
    expect(raf).toHaveBeenCalledTimes(1)
    raf.mock.calls[0][0]()   // one tick: steps, renders, asks for the next
    expect(r.made.render).toHaveBeenCalled()
    expect(raf).toHaveBeenCalledTimes(2)
    w.stop()
    w.stop()
    expect(cancel).toHaveBeenCalledTimes(1)
    w.dispose()
  })

  it('does not draw while the GPU context is lost, and draws again when it is back', () => {
    const w = createDiceWorld(canvas)
    canvas.dispatchEvent(new Event('webglcontextlost'))
    w.render()
    expect(r.made.render).not.toHaveBeenCalled()
    canvas.dispatchEvent(new Event('webglcontextrestored'))
    expect(r.made.render).toHaveBeenCalledTimes(1)
    w.dispose()
  })

  it('follows a change of screen density', () => {
    const w = createDiceWorld(canvas)
    window.devicePixelRatio = 3
    mq.listeners[0]()
    expect(r.made.ratio).toBe(2)   // capped
    expect(r.made.render).toHaveBeenCalled()
    w.dispose()
  })

  it('lets go of everything on dispose', () => {
    const w = createDiceWorld(canvas)
    w.start()
    w.dispose()
    expect(cancel).toHaveBeenCalled()
    expect(r.made.dispose).toHaveBeenCalled()
    expect(mq.removeEventListener).toHaveBeenCalled()
    canvas.dispatchEvent(new Event('webglcontextlost'))   // no listener left: still draws
    w.render()
    expect(r.made.render).toHaveBeenCalledTimes(1)
  })
})
