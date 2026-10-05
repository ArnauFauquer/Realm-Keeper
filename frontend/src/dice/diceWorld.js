import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import { createAssetCache } from './diceAssets'
import { clearShapeCache } from './dicePhysics'

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

// Past 2x the extra pixels cost more GPU memory than they add sharpness.
const MAX_PIXEL_RATIO = 2

function pixelRatio() {
  return Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO)
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
 * body. One world per canvas, kept for as long as the canvas is: the dice
 * overlay's (useDiceRoller) and the screen's (ScreenView). Between rolls it
 * only clears its dice and stops its loop, so shaders and the shared die
 * resources (diceAssets.js) are built once; `dispose` frees everything when
 * the canvas goes away.
 */
export function createDiceWorld(canvas) {
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 100)
  // Mutated in place on resize, so holders of world.trayHalf stay current.
  const trayHalf = trayHalfFor(1)
  frameTray(camera, trayHalf)

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true })
  renderer.setPixelRatio(pixelRatio())
  const assets = createAssetCache()

  // The browser can take the GPU context back (memory pressure, a driver
  // reset, a phone backgrounding the tab). three.js keeps the context
  // restorable and skips drawing meanwhile; the physics doesn't need it, so a
  // roll in flight still lands on a result. Once restored, the dice are drawn
  // again where they are - a finished roll has no loop left to do it.
  let contextLost = false
  function onContextLost() {
    contextLost = true
  }
  function onContextRestored() {
    contextLost = false
    render()
  }
  canvas.addEventListener('webglcontextlost', onContextLost)
  canvas.addEventListener('webglcontextrestored', onContextRestored)

  // Moving the window to a screen of another density changes the pixel ratio
  // without always resizing the canvas: follow it, or the dice go blurry (or
  // cost 4x the pixels). The query matches one ratio, so it is renewed each time.
  let ratioQuery = null
  function watchPixelRatio() {
    ratioQuery?.removeEventListener('change', onPixelRatioChange)
    ratioQuery = window.matchMedia?.(`(resolution: ${window.devicePixelRatio || 1}dppx)`) ?? null
    ratioQuery?.addEventListener('change', onPixelRatioChange)
  }
  function onPixelRatioChange() {
    renderer.setPixelRatio(pixelRatio())
    watchPixelRatio()
    render()
  }
  watchPixelRatio()

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
    if (!contextLost) renderer.render(scene, camera)
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

  // A die's geometry and materials belong to `assets` and outlive it.
  function clearDice() {
    entries.slice().forEach(({ mesh, body }) => {
      scene.remove(mesh)
      world.removeBody(body)
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
    if (renderer.getPixelRatio() !== pixelRatio()) renderer.setPixelRatio(pixelRatio())
    renderer.setSize(width, height, false)
  }

  function dispose() {
    stop()
    clearDice()
    assets.dispose()
    clearShapeCache()
    ratioQuery?.removeEventListener('change', onPixelRatioChange)
    canvas.removeEventListener('webglcontextlost', onContextLost)
    canvas.removeEventListener('webglcontextrestored', onContextRestored)
    renderer.dispose()
  }

  return {
    scene, camera, world, assets, addDie, clearDice, start, stop, resize, dispose,
    stepAndRender, syncMeshes, render,
    trayHalf
  }
}
