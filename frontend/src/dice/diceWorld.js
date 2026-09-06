import * as THREE from 'three'
import * as CANNON from 'cannon-es'

const TRAY_HALF_SIZE = 3.8
const WALL_HEIGHT = 6

/**
 * Owns the three.js scene/camera/renderer and the cannon-es physics world
 * (gravity + a static open-top "tray" that keeps thrown dice in view), and
 * the per-frame loop that steps physics and syncs each die's mesh to its
 * body. One instance is created per roll session by useDiceRoller and
 * disposed once the overlay hides.
 */
export function createDiceWorld(canvas) {
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 100)
  camera.position.set(0, 8, 8)
  camera.lookAt(0, 0.5, 0)

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))

  scene.add(new THREE.HemisphereLight(0xe6e0ff, 0x1a1230, 1.15))
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.0)
  keyLight.position.set(4, 10, 5)
  scene.add(keyLight)
  const fillLight = new THREE.DirectionalLight(0xa78bfa, 0.4)
  fillLight.position.set(-6, 4, -4)
  scene.add(fillLight)

  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -26, 0) })
  world.broadphase = new CANNON.SAPBroadphase(world)
  world.allowSleep = true

  const trayMaterial = new CANNON.Material('tray')
  const diceMaterial = new CANNON.Material('dice')
  world.addContactMaterial(new CANNON.ContactMaterial(trayMaterial, diceMaterial, {
    friction: 0.4,
    restitution: 0.35
  }))
  world.addContactMaterial(new CANNON.ContactMaterial(diceMaterial, diceMaterial, {
    friction: 0.3,
    restitution: 0.4
  }))

  const floorBody = new CANNON.Body({ mass: 0, shape: new CANNON.Plane(), material: trayMaterial })
  floorBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2)
  world.addBody(floorBody)

  const wallDefs = [
    { pos: [TRAY_HALF_SIZE, WALL_HEIGHT / 2, 0], axis: [0, 1, 0], angle: -Math.PI / 2 },
    { pos: [-TRAY_HALF_SIZE, WALL_HEIGHT / 2, 0], axis: [0, 1, 0], angle: Math.PI / 2 },
    { pos: [0, WALL_HEIGHT / 2, TRAY_HALF_SIZE], axis: [0, 1, 0], angle: Math.PI },
    { pos: [0, WALL_HEIGHT / 2, -TRAY_HALF_SIZE], axis: [0, 1, 0], angle: 0 }
  ]
  wallDefs.forEach(({ pos, axis, angle }) => {
    const body = new CANNON.Body({ mass: 0, shape: new CANNON.Plane(), material: trayMaterial })
    body.position.set(pos[0], pos[1], pos[2])
    body.quaternion.setFromAxisAngle(new CANNON.Vec3(axis[0], axis[1], axis[2]), angle)
    world.addBody(body)
  })

  const entries = []
  let rafId = null
  const clock = new THREE.Clock()

  function syncMeshes() {
    entries.forEach(({ mesh, body }) => {
      mesh.position.copy(body.position)
      mesh.quaternion.copy(body.quaternion)
    })
  }

  function render() {
    renderer.render(scene, camera)
  }

  // Physics-step and render/sync, kept separable so a scripted replay (see
  // dice/diceRoller.js's replayGroups) can drive the physics itself in a
  // tab that may not be visible - requestAnimationFrame (and this internal
  // tick loop) is fully suspended by the browser for hidden/background
  // tabs, which a "cast to a second screen" tab often is.
  function stepAndRender(dt) {
    world.step(1 / 60, dt, 6)
    syncMeshes()
    render()
  }

  function tick() {
    const dt = Math.min(clock.getDelta(), 1 / 30)
    stepAndRender(dt)
    rafId = requestAnimationFrame(tick)
  }

  function start() {
    if (rafId != null) return
    clock.start()
    rafId = requestAnimationFrame(tick)
  }

  function stop() {
    if (rafId == null) return
    cancelAnimationFrame(rafId)
    rafId = null
  }

  function addDie(mesh, body) {
    body.material = diceMaterial
    scene.add(mesh)
    world.addBody(body)
    entries.push({ mesh, body })
  }

  function disposeMesh(mesh) {
    mesh.geometry?.dispose?.()
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    materials.forEach(m => {
      m?.map?.dispose?.()
      m?.dispose?.()
    })
  }

  function clearDice() {
    entries.slice().forEach(({ mesh, body }) => {
      scene.remove(mesh)
      world.removeBody(body)
      disposeMesh(mesh)
    })
    entries.length = 0
  }

  function resize(width, height) {
    if (!width || !height) return
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    renderer.setSize(width, height, false)
  }

  function dispose() {
    stop()
    clearDice()
    renderer.dispose()
  }

  return {
    scene, camera, world, addDie, clearDice, start, stop, resize, dispose,
    stepAndRender, syncMeshes, render,
    trayHalfSize: TRAY_HALF_SIZE
  }
}
