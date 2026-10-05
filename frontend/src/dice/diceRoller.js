import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import { buildDie } from './diceGeometries'
import { buildFaceMaterials } from './diceTextures'
import { convexShapeForGeometry } from './dicePhysics'
import { themeForKind } from './diceTheme'
import { themeKey } from './diceAssets'
import { MAX_DICE, SUPPORTED_SIDES, rollResult } from '@/utils/diceNotation'

const UP = new THREE.Vector3(0, 1, 0)
// If the winning and runner-up face are this close in "up-ness", the die is
// treated as resting in an ambiguous/edge-balanced pose (mainly a risk for
// the d10's kite faces) and gets one corrective nudge before being read.
const AMBIGUOUS_MARGIN = 0.12
// The camera looks almost straight down (see diceWorld.js), so spawn heights
// cycle through a few layers instead of stacking one die per layer forever -
// a big roll would otherwise start dice above (or right in front of) the
// camera. Consecutive dice get spread around the tray by the golden angle
// so dice sharing a layer don't start inside each other.
const SPAWN_LAYERS = 8

const LINEAR_DAMPING = 0.12
const ANGULAR_DAMPING = 0.2
// A die counts as at rest once it has stayed below these speeds for
// REST_TIME of simulated time. cannon's own sleep test (one combined, much
// stricter limit) is easily kept awake by the tiny contact jitter of a
// convex polyhedron on the floor or against another die, which used to make
// a roll wait out the full timeout before showing its result.
const REST_LINEAR_SPEED = 0.15
const REST_ANGULAR_SPEED = 0.35
const REST_TIME = 0.25
// A die jittering in place - wedged against another die or a wall - can keep
// a high instantaneous speed while going nowhere, so a die that stays within
// these of where its rest window began also counts as at rest.
const STILL_DISTANCE = 0.03
const STILL_ANGLE = 0.05
// Simulated seconds after which dice still moving get heavy damping, so a
// die spinning on a vertex or rocking on an edge stops instead of stalling
// the result. The corrective nudge is only a small hop, so it gets less.
const ASSIST_AFTER = 1.8
const NUDGE_ASSIST_AFTER = 0.9
const ASSIST_DAMPING = 0.7
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

function spawnDie(world, { sides, variant, index, theme }) {
  const cacheKey = variant ? `${sides}-${variant}` : `${sides}`
  // Shared by every die of the kind (and colour) in this world, see diceAssets.js.
  const { geometry, faceTable, materialLabels } = world.assets.get(`die:${cacheKey}`, () => buildDie(sides, variant))
  const materials = world.assets.get(`faces:${cacheKey}:${themeKey(theme)}`, () => buildFaceMaterials(materialLabels, theme))
  const mesh = new THREE.Mesh(geometry, materials)

  const shape = convexShapeForGeometry(cacheKey, geometry)

  const angle = index * GOLDEN_ANGLE + (Math.random() - 0.5) * 0.6
  // Somewhere in the middle of the tray, following its shape.
  const dist = 0.16 + Math.random() * 0.5
  const x = Math.cos(angle) * dist * world.trayHalf.x
  const z = Math.sin(angle) * dist * world.trayHalf.z
  const y = 4.5 + (index % SPAWN_LAYERS) * 0.6

  const body = new CANNON.Body({ mass: 1, position: new CANNON.Vec3(x, y, z), shape })
  body.quaternion.setFromEuler(
    Math.random() * Math.PI * 2,
    Math.random() * Math.PI * 2,
    Math.random() * Math.PI * 2
  )
  body.velocity.set((Math.random() - 0.5) * 5, -1 - Math.random(), (Math.random() - 0.5) * 5)
  body.angularVelocity.set(
    (Math.random() - 0.5) * 20,
    (Math.random() - 0.5) * 20,
    (Math.random() - 0.5) * 20
  )
  body.allowSleep = true
  body.sleepSpeedLimit = 0.09
  body.sleepTimeLimit = 0.35
  body.linearDamping = LINEAR_DAMPING
  body.angularDamping = ANGULAR_DAMPING

  world.addDie(mesh, body)
  return { mesh, body, faceTable }
}

function readFace(entry) {
  const q = entry.body.quaternion
  const quat = new THREE.Quaternion(q.x, q.y, q.z, q.w)
  let best = null
  let bestDot = -Infinity
  let secondDot = -Infinity
  entry.faceTable.forEach(face => {
    const n = face.localNormal.clone().applyQuaternion(quat)
    const dot = n.dot(UP)
    if (dot > bestDot) {
      secondDot = bestDot
      bestDot = dot
      best = face
    } else if (dot > secondDot) {
      secondDot = dot
    }
  })
  return { value: best.value, margin: bestDot - secondDot }
}

function nudge(entry) {
  entry.body.wakeUp()
  entry.body.linearDamping = LINEAR_DAMPING
  entry.body.angularDamping = ANGULAR_DAMPING
  entry.body.velocity.set((Math.random() - 0.5) * 1.5, 2 + Math.random(), (Math.random() - 0.5) * 1.5)
  entry.body.angularVelocity.set(
    (Math.random() - 0.5) * 10,
    (Math.random() - 0.5) * 10,
    (Math.random() - 0.5) * 10
  )
}

function isSlow(body) {
  return body.velocity.length() < REST_LINEAR_SPEED &&
    body.angularVelocity.length() < REST_ANGULAR_SPEED
}

function hasMoved(body, anchor) {
  if (body.position.distanceTo(anchor.position) > STILL_DISTANCE) return true
  const dot = Math.min(1, Math.abs(
    body.quaternion.x * anchor.quaternion.x + body.quaternion.y * anchor.quaternion.y +
    body.quaternion.z * anchor.quaternion.z + body.quaternion.w * anchor.quaternion.w
  ))
  return 2 * Math.acos(dot) > STILL_ANGLE
}

function anchorOf(body) {
  return { position: body.position.clone(), quaternion: body.quaternion.clone() }
}

/**
 * Resolves once every die has been at rest for REST_TIME (then freezes it,
 * so a die bumped later can't change what was read), checked after each
 * physics step in simulated time - so a slow or throttled frame rate
 * doesn't change when dice count as settled. `timeoutMs` is a wall-clock
 * backstop for when steps stop coming at all (e.g. a hidden tab).
 */
function waitForSettle(world, entries, { timeoutMs = 4500, assistAfter = ASSIST_AFTER } = {}) {
  return new Promise(resolve => {
    const physics = world.world
    // A die that is already asleep (settled in an earlier wait) counts as at
    // rest straight away - it only holds things up if something wakes it.
    const restFor = new Map(entries.map(e => [e.body, e.body.sleepState === CANNON.Body.SLEEPING ? REST_TIME : 0]))
    const anchors = new Map(entries.map(e => [e.body, anchorOf(e.body)]))
    let elapsed = 0
    let assisted = false
    let settled = false
    const timeout = setTimeout(finish, timeoutMs)

    function onPostStep() {
      const dt = physics.dt > 0 ? physics.dt : 1 / 60
      elapsed += dt

      if (!assisted && elapsed >= assistAfter) {
        assisted = true
        restFor.forEach((t, body) => {
          if (t < REST_TIME) {
            body.linearDamping = ASSIST_DAMPING
            body.angularDamping = ASSIST_DAMPING
          }
        })
      }

      let allAtRest = true
      restFor.forEach((t, body) => {
        const moved = hasMoved(body, anchors.get(body))
        if (moved) anchors.set(body, anchorOf(body))
        const atRest = body.sleepState === CANNON.Body.SLEEPING || isSlow(body) || !moved
        const next = atRest ? t + dt : 0
        restFor.set(body, next)
        if (next < REST_TIME) allAtRest = false
      })
      if (allAtRest) finish()
    }
    physics.addEventListener('postStep', onPostStep)

    function finish() {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      physics.removeEventListener('postStep', onPostStep)
      restFor.forEach((t, body) => {
        body.velocity.set(0, 0, 0)
        body.angularVelocity.set(0, 0, 0)
        body.sleep()
      })
      resolve()
    }
  })
}

/**
 * Spawns and throws dice for a parsed formula (utils/diceNotation.js),
 * waits for everything to settle, resolves ambiguous rests with a single
 * nudge, and returns { total, groups, flatModifier } - groups mirrors the
 * parsed terms with each die's individually-read value attached, so the
 * toast can show a full breakdown, not just the sum.
 */
export async function rollParsedFormula(world, parsed, theme) {
  const entries = []
  let index = 0

  const groupPlans = parsed.terms.map(term => {
    const dice = []
    for (let i = 0; i < term.count; i++) {
      if (term.sides === 100) {
        const tens = spawnDie(world, { sides: 100, variant: 'tens', index: index++, theme })
        const units = spawnDie(world, { sides: 100, variant: 'units', index: index++, theme })
        entries.push(tens, units)
        dice.push({ pair: [tens, units] })
      } else {
        const die = spawnDie(world, { sides: term.sides, index: index++, theme: themeForKind(term.kind, theme) })
        entries.push(die)
        dice.push({ single: die })
      }
    }
    return { sides: term.sides, sign: term.sign, kind: term.kind, keep: term.keep, dice }
  })

  world.start()
  await waitForSettle(world, entries)

  const ambiguous = entries.filter(e => readFace(e).margin < AMBIGUOUS_MARGIN)
  if (ambiguous.length) {
    ambiguous.forEach(nudge)
    // Wait on every die, not just the nudged ones: a hop can knock into a
    // die that had already settled, and it must come to rest again before
    // anything is read.
    await waitForSettle(world, entries, { timeoutMs: 2500, assistAfter: NUDGE_ASSIST_AFTER })
  }

  const rolls = groupPlans.map(plan => plan.dice.map(d => {
    if (d.pair) {
      const tensValue = readFace(d.pair[0]).value
      const unitsValue = readFace(d.pair[1]).value
      return (tensValue === 0 && unitsValue === 0) ? 100 : tensValue + unitsValue
    }
    return readFace(d.single).value
  }))
  return rollResult(parsed.terms, rolls, parsed.flatModifier)
}

/** Splits a percentile total back into its tens/units dice values (the
 * inverse of the summing rule in rollParsedFormula), so a replay can spawn
 * two d10s and know which face each one must land on. */
function decomposePercentile(total) {
  if (total === 100) return { tens: 0, units: 0 }
  return { tens: Math.floor(total / 10) * 10, units: total % 10 }
}

/** The quaternion that rotates the given face's local normal (a vertex
 * direction for the d4) to point "up" - the inverse of readFace's argmax,
 * used to force a die to land on a predetermined value for a replay rather
 * than an organically-read one. */
function quaternionForValue(faceTable, value) {
  const face = faceTable.find(f => f.value === value) || faceTable[0]
  const target = new THREE.Vector3(0, 1, 0)
  const align = new THREE.Quaternion().setFromUnitVectors(face.localNormal.clone().normalize(), target)
  // Random spin around the vertical axis so repeat rolls of the same value
  // don't all look visually identical once settled.
  const spin = new THREE.Quaternion().setFromAxisAngle(target, Math.random() * Math.PI * 2)
  return spin.multiply(align)
}

/**
 * Replays an already-known roll result (e.g. one broadcast to the /screen
 * display from another tab/device) as a 3D animation: spawns and throws the
 * same dice for visual flair, then - since we don't control what a second,
 * independent physics simulation would organically land on - snaps each die
 * to the predetermined correct face after a fixed tumble duration instead of
 * reading whatever it happens to settle on. `groups` is the same shape
 * `rollParsedFormula` returns (`[{sides, sign, rolls: [values]}]`), where
 * each `rolls[i]` is the final value already computed by the original roll.
 *
 * The groups arrive over the network, so they are taken with care: at most
 * MAX_DICE dice are thrown, and a die of a size this table can't build is
 * skipped instead of throwing halfway, with dice already in the air. Aborting
 * `signal` (a newer roll took over) stops the tumble where it is and leaves
 * the dice unsnapped.
 */
export async function replayGroups(world, groups, theme, { tumbleMs = 1700, signal } = {}) {
  const targets = []
  let index = 0

  for (const group of groups || []) {
    if (!SUPPORTED_SIDES.includes(group?.sides) || !Array.isArray(group.rolls)) continue
    const dicePerRoll = group.sides === 100 ? 2 : 1
    for (const value of group.rolls) {
      if (index + dicePerRoll > MAX_DICE) break
      if (group.sides === 100) {
        const { tens, units } = decomposePercentile(value)
        const tensDie = spawnDie(world, { sides: 100, variant: 'tens', index: index++, theme })
        const unitsDie = spawnDie(world, { sides: 100, variant: 'units', index: index++, theme })
        targets.push({ entry: tensDie, value: tens }, { entry: unitsDie, value: units })
      } else {
        const die = spawnDie(world, { sides: group.sides, index: index++, theme: themeForKind(group.kind, theme) })
        targets.push({ entry: die, value })
      }
    }
  }

  await tumble(world, tumbleMs, signal)
  if (signal?.aborted) return

  targets.forEach(({ entry, value }) => {
    const quat = quaternionForValue(entry.faceTable, value)
    entry.body.quaternion.copy(quat)
    entry.body.velocity.set(0, 0, 0)
    entry.body.angularVelocity.set(0, 0, 0)
    entry.body.sleep()
  })
  world.syncMeshes()
  world.render()
}

/**
 * Advances the physics simulation by exactly `durationMs` of simulated time,
 * pacing it against requestAnimationFrame when available so a visible tab
 * gets a smooth tumbling animation - but a /screen tab showing this replay
 * is very often NOT the focused tab (the GM is looking at their own device
 * while a second screen/TV just displays this page), and rAF is fully
 * suspended by the browser for hidden/background tabs. The `setTimeout`
 * fallback below fires regardless of tab visibility and fast-forwards any
 * remaining steps in one go, so the dice always end up actually fallen and
 * settled - never left floating at their spawn height - before the values
 * get force-corrected onto their predetermined faces.
 *
 * Aborting `signal` ends it at once, without the fast-forward: the world is
 * about to be cleared for another roll, and a loop left running would keep
 * stepping and drawing the next roll's dice alongside its own.
 */
function tumble(world, durationMs, signal) {
  const stepDt = 1 / 60
  const totalSteps = Math.round((durationMs / 1000) / stepDt)
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())
  let stepsDone = 0
  let finished = false
  let frameId = null
  let timer = null

  return new Promise(resolve => {
    function end() {
      if (finished) return
      finished = true
      clearTimeout(timer)
      if (frameId != null) cancelAnimationFrame(frameId)
      signal?.removeEventListener('abort', end)
      resolve()
    }

    function finish() {
      if (finished) return
      while (stepsDone < totalSteps) {
        world.stepAndRender(stepDt)
        stepsDone++
      }
      end()
    }

    if (signal?.aborted) {
      end()
      return
    }
    signal?.addEventListener('abort', end)

    const startTime = now()
    function frame() {
      frameId = null
      if (finished) return
      const elapsed = now() - startTime
      const targetSteps = Math.min(totalSteps, Math.floor((elapsed / 1000) / stepDt))
      while (stepsDone < targetSteps) {
        world.stepAndRender(stepDt)
        stepsDone++
      }
      if (stepsDone >= totalSteps) {
        finish()
        return
      }
      frameId = requestAnimationFrame(frame)
    }
    if (typeof requestAnimationFrame === 'function') frameId = requestAnimationFrame(frame)
    timer = setTimeout(finish, durationMs + 250)
  })
}
