import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import { buildDie } from './diceGeometries'
import { buildFaceMaterials } from './diceTextures'
import { convexShapeForGeometry } from './dicePhysics'

const UP = new THREE.Vector3(0, 1, 0)
// If the winning and runner-up face are this close in "up-ness", the die is
// treated as resting in an ambiguous/edge-balanced pose (mainly a risk for
// the d10's kite faces) and gets one corrective nudge before being read.
const AMBIGUOUS_MARGIN = 0.12

function spawnDie(world, { sides, variant, index, theme }) {
  const { geometry, faceTable, materialLabels } = buildDie(sides, variant)
  const materials = buildFaceMaterials(materialLabels, theme)
  const mesh = new THREE.Mesh(geometry, materials)

  const cacheKey = variant ? `${sides}-${variant}` : `${sides}`
  const shape = convexShapeForGeometry(cacheKey, geometry)

  const angle = Math.random() * Math.PI * 2
  const dist = 0.6 + Math.random() * (world.trayHalfSize * 0.5)
  const x = Math.cos(angle) * dist
  const z = Math.sin(angle) * dist
  const y = 5.5 + index * 0.55

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
  body.linearDamping = 0.12
  body.angularDamping = 0.2

  world.addDie(mesh, body)
  return { mesh, body, faceTable, invertUp: sides === 4 }
}

function readFace(entry) {
  const q = entry.body.quaternion
  const quat = new THREE.Quaternion(q.x, q.y, q.z, q.w)
  let best = null
  let bestDot = -Infinity
  let secondDot = -Infinity
  entry.faceTable.forEach(face => {
    const n = face.localNormal.clone().applyQuaternion(quat)
    let dot = n.dot(UP)
    if (entry.invertUp) dot = -dot
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
  entry.body.velocity.set((Math.random() - 0.5) * 1.5, 2 + Math.random(), (Math.random() - 0.5) * 1.5)
  entry.body.angularVelocity.set(
    (Math.random() - 0.5) * 10,
    (Math.random() - 0.5) * 10,
    (Math.random() - 0.5) * 10
  )
}

function waitForSettle(entries, { timeoutMs = 6000 } = {}) {
  return new Promise(resolve => {
    const pending = new Set(entries.map(e => e.body))
    let settled = false
    const timeout = setTimeout(finish, timeoutMs)

    function onSleep(event) {
      pending.delete(event.target)
      if (pending.size === 0) finish()
    }
    entries.forEach(e => e.body.addEventListener('sleep', onSleep))

    function finish() {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      entries.forEach(e => e.body.removeEventListener('sleep', onSleep))
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
        const die = spawnDie(world, { sides: term.sides, index: index++, theme })
        entries.push(die)
        dice.push({ single: die })
      }
    }
    return { sides: term.sides, sign: term.sign, dice }
  })

  world.start()
  await waitForSettle(entries)

  const ambiguous = entries.filter(e => readFace(e).margin < AMBIGUOUS_MARGIN)
  if (ambiguous.length) {
    ambiguous.forEach(nudge)
    await waitForSettle(ambiguous, { timeoutMs: 3000 })
  }

  let total = parsed.flatModifier
  const groups = groupPlans.map(plan => {
    const rolls = plan.dice.map(d => {
      if (d.pair) {
        const tensValue = readFace(d.pair[0]).value
        const unitsValue = readFace(d.pair[1]).value
        return (tensValue === 0 && unitsValue === 0) ? 100 : tensValue + unitsValue
      }
      return readFace(d.single).value
    })
    total += rolls.reduce((a, b) => a + b, 0) * plan.sign
    return { sides: plan.sides, sign: plan.sign, rolls }
  })

  return { total, groups, flatModifier: parsed.flatModifier }
}

/** Splits a percentile total back into its tens/units dice values (the
 * inverse of the summing rule in rollParsedFormula), so a replay can spawn
 * two d10s and know which face each one must land on. */
function decomposePercentile(total) {
  if (total === 100) return { tens: 0, units: 0 }
  return { tens: Math.floor(total / 10) * 10, units: total % 10 }
}

/** The quaternion that rotates the given face's local normal to point
 * "up" (or "down" for a die like d4 that reads its floor-touching face) -
 * the inverse of readFace's argmax, used to force a die to land on a
 * predetermined value for a replay rather than an organically-read one. */
function quaternionForValue(faceTable, value, invertUp) {
  const face = faceTable.find(f => f.value === value) || faceTable[0]
  const target = invertUp ? new THREE.Vector3(0, -1, 0) : new THREE.Vector3(0, 1, 0)
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
 */
export async function replayGroups(world, groups, theme, { tumbleMs = 1700 } = {}) {
  const targets = []
  let index = 0

  groups.forEach(group => {
    group.rolls.forEach(value => {
      if (group.sides === 100) {
        const { tens, units } = decomposePercentile(value)
        const tensDie = spawnDie(world, { sides: 100, variant: 'tens', index: index++, theme })
        const unitsDie = spawnDie(world, { sides: 100, variant: 'units', index: index++, theme })
        targets.push({ entry: tensDie, value: tens }, { entry: unitsDie, value: units })
      } else {
        const die = spawnDie(world, { sides: group.sides, index: index++, theme })
        targets.push({ entry: die, value })
      }
    })
  })

  await tumble(world, tumbleMs)

  targets.forEach(({ entry, value }) => {
    const quat = quaternionForValue(entry.faceTable, value, entry.invertUp)
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
 */
function tumble(world, durationMs) {
  const stepDt = 1 / 60
  const totalSteps = Math.round((durationMs / 1000) / stepDt)
  let stepsDone = 0
  let finished = false

  return new Promise(resolve => {
    function finish() {
      if (finished) return
      finished = true
      while (stepsDone < totalSteps) {
        world.stepAndRender(stepDt)
        stepsDone++
      }
      resolve()
    }

    const startTime = (typeof performance !== 'undefined' ? performance.now() : Date.now())
    function frame() {
      if (finished) return
      const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startTime
      const targetSteps = Math.min(totalSteps, Math.floor((elapsed / 1000) / stepDt))
      while (stepsDone < targetSteps) {
        world.stepAndRender(stepDt)
        stepsDone++
      }
      if (stepsDone >= totalSteps) {
        finish()
        return
      }
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
    setTimeout(finish, durationMs + 250)
  })
}
