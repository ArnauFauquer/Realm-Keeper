import * as THREE from 'three'

// Triangles belonging to the same logical face can have normals that differ
// by a small fraction of a degree (floating-point noise in three.js's own
// Platonic-solid construction, most visible on DodecahedronGeometry's
// triangulated pentagons) - comparing via dot product with a generous
// angular tolerance is robust to that, where exact-equality string-keying
// was not.
const FACE_ANGLE_COS_THRESHOLD = Math.cos(THREE.MathUtils.degToRad(5))

/**
 * Clusters a non-indexed geometry's triangles into contiguous runs sharing
 * (within a small angular tolerance) the same face normal - i.e. the
 * logical polygonal faces of the polyhedron, regardless of how many
 * triangles three.js split each one into. Assumes (true for every built-in
 * Platonic-solid geometry used here) that a face's triangles are emitted
 * contiguously.
 */
function clusterFacesByNormal(geometry) {
  const pos = geometry.attributes.position
  const triCount = pos.count / 3
  const groups = []
  let current = null
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()

  for (let t = 0; t < triCount; t++) {
    a.fromBufferAttribute(pos, t * 3)
    b.fromBufferAttribute(pos, t * 3 + 1)
    c.fromBufferAttribute(pos, t * 3 + 2)
    const normal = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize()
    if (current && current.normal.dot(normal) > FACE_ANGLE_COS_THRESHOLD) {
      current.triCount++
    } else {
      current = { normal: normal.clone(), triStart: t, triCount: 1 }
      groups.push(current)
    }
  }
  return groups
}

function applyFaceGroups(geometry, groups) {
  geometry.clearGroups()
  groups.forEach((g, i) => geometry.addGroup(g.triStart * 3, g.triCount * 3, i))
}

/**
 * Overwrites the geometry's UV attribute so each logical face's own
 * triangles are projected into their own full 0-1 square, centered and
 * uniformly scaled to fit. Platonic-solid geometries only ship a single
 * sphere-unwrapped UV set meant for a single tiled texture, which puts a
 * per-face numeral texture in the wrong place/orientation/scale on every
 * face; this replaces it with a mapping tailored to "one numeral per face".
 */
function assignFaceUVs(geometry, faces) {
  const pos = geometry.attributes.position
  const uv = new Float32Array(pos.count * 2)
  const p = new THREE.Vector3()
  const centroid = new THREE.Vector3()
  const right = new THREE.Vector3()
  const trueUp = new THREE.Vector3()
  const worldUp = new THREE.Vector3(0, 1, 0)
  const altUp = new THREE.Vector3(1, 0, 0)

  faces.forEach(face => {
    const startVertex = face.triStart * 3
    const endVertex = startVertex + face.triCount * 3

    centroid.set(0, 0, 0)
    for (let v = startVertex; v < endVertex; v++) {
      centroid.add(p.fromBufferAttribute(pos, v))
    }
    centroid.divideScalar(endVertex - startVertex)

    const up = Math.abs(face.normal.dot(worldUp)) > 0.95 ? altUp : worldUp
    right.crossVectors(up, face.normal).normalize()
    trueUp.crossVectors(face.normal, right).normalize()

    const us = []
    const vs = []
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity
    for (let v = startVertex; v < endVertex; v++) {
      p.fromBufferAttribute(pos, v).sub(centroid)
      const u = p.dot(right)
      const w = p.dot(trueUp)
      us.push(u)
      vs.push(w)
      if (u < minU) minU = u
      if (u > maxU) maxU = u
      if (w < minV) minV = w
      if (w > maxV) maxV = w
    }
    // Uniform scale (not stretched per-axis) so a square numeral texture
    // isn't distorted on non-square (triangular/pentagonal) faces.
    const span = Math.max(maxU - minU, maxV - minV, 1e-6) * 1.05

    for (let i = 0, v = startVertex; v < endVertex; v++, i++) {
      uv[v * 2] = 0.5 + us[i] / span
      uv[v * 2 + 1] = 0.5 + vs[i] / span
    }
  })

  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
}

/** Builds a die from a PolyhedronGeometry-family shape (already non-indexed,
 * one face = 1+ contiguous triangles) by auto-discovering its faces. */
function buildClusteredDie(geometry, values, labels) {
  const groups = clusterFacesByNormal(geometry)
  applyFaceGroups(geometry, groups)
  assignFaceUVs(geometry, groups)

  if (groups.length !== values.length) {
    // Defensive fallback in case a given three.js geometry doesn't emit a
    // face's triangles contiguously (see comment above) - cycle the value
    // set rather than leave later groups with an undefined value/label.
    console.warn(`diceGeometries: expected ${values.length} faces, discovered ${groups.length}`)
  }
  const valueAt = (i) => values[i % values.length]
  const labelAt = (i) => (labels ? labels[i % labels.length] : String(valueAt(i)))

  const faceTable = groups.map((g, i) => ({ localNormal: g.normal, value: valueAt(i) }))
  const materialLabels = groups.map((g, i) => labelAt(i))
  return { geometry, faceTable, materialLabels }
}

export function buildD4(radius = 1) {
  const geo = new THREE.TetrahedronGeometry(radius)
  // A tetrahedron always rests face-down/vertex-up, so the "up" reading
  // (see diceRoller.js) is inverted for this die only; the value assigned
  // to each face here is the number that should be reported when that
  // face is the one touching the floor.
  return buildClusteredDie(geo, [1, 2, 3, 4])
}

export function buildD8(radius = 1) {
  const geo = new THREE.OctahedronGeometry(radius)
  return buildClusteredDie(geo, [1, 2, 3, 4, 5, 6, 7, 8])
}

export function buildD12(radius = 1) {
  const geo = new THREE.DodecahedronGeometry(radius)
  return buildClusteredDie(geo, Array.from({ length: 12 }, (_, i) => i + 1))
}

export function buildD20(radius = 1) {
  const geo = new THREE.IcosahedronGeometry(radius)
  return buildClusteredDie(geo, Array.from({ length: 20 }, (_, i) => i + 1))
}

/** BoxGeometry ships with 6 native per-face material groups in a known,
 * documented order [+x, -x, +y, -y, +z, -z] - no clustering needed, and we
 * can assign the classic opposite-faces-sum-to-7 numbering directly. */
export function buildD6(size = 1.5) {
  const geometry = new THREE.BoxGeometry(size, size, size)
  const localNormals = [
    new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0),
    new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0),
    new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)
  ]
  const values = [1, 6, 2, 5, 3, 4]
  const faceTable = localNormals.map((n, i) => ({ localNormal: n, value: values[i] }))
  const materialLabels = values.map(String)
  return { geometry, faceTable, materialLabels }
}

/** CylinderGeometry ships with 3 native groups: [side, top, bottom]. Only
 * the two caps get a printed value; the side band is left unlabeled. */
export function buildD2(radius = 1, thickness = 0.32) {
  const geometry = new THREE.CylinderGeometry(radius, radius, thickness, 32, 1, false)
  const faceTable = [
    { localNormal: new THREE.Vector3(0, 1, 0), value: 1 },
    { localNormal: new THREE.Vector3(0, -1, 0), value: 2 }
  ]
  const materialLabels = [null, '1', '2']
  return { geometry, faceTable, materialLabels }
}

/**
 * Hand-built pentagonal trapezohedron (the classic d10 shape): 2 pole
 * vertices + a 10-point equatorial ring alternating a small z-offset in a
 * zigzag, giving 10 kite-shaped faces (fan-triangulated from each pole).
 * We author the triangle order ourselves, so faces are contiguous by
 * construction - no clustering pass needed.
 *
 * The pole height and equatorial z-tilt below aren't arbitrary - they're
 * the exact ratios (relative to the equatorial ring's radius) that make
 * this the polar dual of a uniform pentagonal antiprism, which is what
 * guarantees the result is a genuinely convex, planar-faced trapezohedron.
 * Picking these by eye (as an earlier version of this function did)
 * produces a shape where several vertices poke outside their neighboring
 * faces' planes - visually a jumble of extra/self-intersecting polygons,
 * since the die is no longer convex. `zSquash` uniformly rescales the
 * z-axis afterward for a stouter silhouette closer to a real die; affine
 * rescaling along one axis preserves convexity, so this stays safe for any
 * factor in (0, 1].
 *
 * `values`/`labels` let the same builder produce a plain d10 (1-10), or the
 * tens/units dice used for a d100/percentile roll.
 */
export function buildD10(config = {}) {
  const {
    radius = 1,
    values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    labels = values.map(v => String(v === 0 ? '0' : v)),
    zSquash = 0.72
  } = config

  const z0 = radius * 0.1909830056250526 * zSquash
  const poleHeight = radius * 1.8090169943749472 * zSquash
  const north = new THREE.Vector3(0, 0, poleHeight)
  const south = new THREE.Vector3(0, 0, -poleHeight)
  const equator = []
  for (let i = 0; i < 10; i++) {
    const angle = (i / 10) * Math.PI * 2
    const z = (i % 2 === 0 ? 1 : -1) * z0
    equator.push(new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, z))
  }

  const positions = []
  const faceTable = []
  const tmpNormal = new THREE.Vector3()
  const tmpCentroid = new THREE.Vector3()

  function pushTriangle(p0, p1, p2) {
    tmpCentroid.copy(p0).add(p1).add(p2).divideScalar(3)
    tmpNormal.subVectors(p1, p0).cross(new THREE.Vector3().subVectors(p2, p0)).normalize()
    let ordered = [p0, p1, p2]
    if (tmpNormal.dot(tmpCentroid) < 0) {
      ordered = [p0, p2, p1]
      tmpNormal.negate()
    }
    ordered.forEach(p => positions.push(p.x, p.y, p.z))
    return tmpNormal.clone()
  }

  for (let i = 0; i < 10; i++) {
    const a = equator[i]
    const b = equator[(i + 1) % 10]
    const c = equator[(i + 2) % 10]
    const zSum = Math.sign(a.z) + Math.sign(b.z) + Math.sign(c.z)
    const pole = zSum > 0 ? north : south

    const n1 = pushTriangle(pole, a, b)
    const n2 = pushTriangle(pole, b, c)
    const faceNormal = n1.add(n2).normalize()

    faceTable.push({ localNormal: faceNormal, value: values[i] })
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.computeVertexNormals()

  const faceGroups = faceTable.map((f, i) => ({ normal: f.localNormal, triStart: i * 2, triCount: 2 }))
  applyFaceGroups(geometry, faceGroups)
  assignFaceUVs(geometry, faceGroups)

  return { geometry, faceTable, materialLabels: labels }
}

export const DIE_BUILDERS = {
  2: (opts) => buildD2(opts?.radius),
  4: (opts) => buildD4(opts?.radius),
  6: (opts) => buildD6(opts?.size),
  8: (opts) => buildD8(opts?.radius),
  10: (opts) => buildD10(opts),
  12: (opts) => buildD12(opts?.radius),
  20: (opts) => buildD20(opts?.radius)
}

export const PERCENTILE_TENS_CONFIG = {
  values: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90],
  labels: ['00', '10', '20', '30', '40', '50', '60', '70', '80', '90']
}

export const PERCENTILE_UNITS_CONFIG = {
  values: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  labels: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']
}

/** Builds a fresh {geometry, faceTable, materialLabels} for one die of the
 * given side count. `sides: 100` yields the two-die percentile pair. */
export function buildDie(sides, variant) {
  if (sides === 100) {
    const config = variant === 'units' ? PERCENTILE_UNITS_CONFIG : PERCENTILE_TENS_CONFIG
    return buildD10(config)
  }
  const builder = DIE_BUILDERS[sides]
  if (!builder) throw new Error(`Unsupported die: d${sides}`)
  return builder()
}
