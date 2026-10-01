import * as THREE from 'three'
import * as CANNON from 'cannon-es'

// The tray follows the viewport's shape: its half-extent along the screen's
// shorter side is fixed and the longer side stretches with the aspect ratio
// (up to a cap), so a portrait phone gets a tall tray instead of a square
// one the camera must back away from - which left the dice tiny. A bigger
// tray also reads as smaller dice, without touching their physics. A
// portrait (phone) screen is physically small, so its tray is a little
// narrower to keep the dice readable there.
const TRAY_SHORT_HALF = 4.8
const TRAY_SHORT_HALF_PORTRAIT = 3.9
const MAX_TRAY_ASPECT = 2.2
const WALL_HEIGHT = 6
const CAMERA_FOV = 36
// Nearly top-down, so the face each die lands on is read straight-on; the
// small tilt keeps a hint of depth on the dice.
const CAMERA_TILT = THREE.MathUtils.degToRad(8)
// Margin around the tray that the camera keeps in frame.
const FRAME_MARGIN = 0.6

/** Tray half-extents (world x = screen width, z = screen height) for a
 * viewport aspect ratio (width / height). */
function trayHalfFor(aspect) {
  const stretch = Math.min(Math.max(aspect, 1 / aspect), MAX_TRAY_ASPECT)
  return aspect >= 1
    ? { x: TRAY_SHORT_HALF * stretch, z: TRAY_SHORT_HALF }
    : { x: TRAY_SHORT_HALF_PORTRAIT, z: TRAY_SHORT_HALF_PORTRAIT * stretch }
}

/** Places the camera far enough back that the whole tray fits the viewport
 * along both axes. */
function frameTray(camera, half) {
  const tanHalfFov = Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV / 2))
  const distance = Math.max(
    (half.z + FRAME_MARGIN) / tanHalfFov,
    (half.x + FRAME_MARGIN) / (tanHalfFov * camera.aspect)
  )
  camera.position.set(0, distance * Math.cos(CAMERA_TILT), distance * Math.sin(CAMERA_TILT))
  camera.lookAt(0, 0, 0)
}

/**
 * Owns the three.js scene/camera/renderer and the cannon-es physics world
 * (gravity + a static open-top "tray" that keeps thrown dice in view), and
 * the per-frame loop that steps physics and syncs each die's mesh to its
 * body. One instance is created per roll session by useDiceRoller and
 * disposed once the overlay hides.
 */
export function createDiceWorld(canvas) {
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 100)
  // Mutated in place on resize, so holders of world.trayHalf stay current.
  const trayHalf = trayHalfFor(1)
  frameTray(camera, trayHalf)

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

  // Each wall: which tray edge it sits on (+/-x, +/-z) and the rotation
  // that turns the plane's normal inward.
  const walls = [
    { axis: 'x', side: 1, angle: -Math.PI / 2 },
    { axis: 'x', side: -1, angle: Math.PI / 2 },
    { axis: 'z', side: 1, angle: Math.PI },
    { axis: 'z', side: -1, angle: 0 }
  ].map(def => {
    const body = new CANNON.Body({ mass: 0, shape: new CANNON.Plane(), material: trayMaterial })
    body.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), def.angle)
    world.addBody(body)
    return { ...def, body }
  })

  function layoutTray() {
    walls.forEach(({ axis, side, body }) => {
      const offset = side * trayHalf[axis]
      body.position.set(axis === 'x' ? offset : 0, WALL_HEIGHT / 2, axis === 'z' ? offset : 0)
    })
  }
  layoutTray()

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
    Object.assign(trayHalf, trayHalfFor(camera.aspect))
    layoutTray()
    frameTray(camera, trayHalf)
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
    trayHalf
  }
}
