import * as THREE from 'three'
import * as CANNON from 'cannon-es'

const shapeCache = new Map()

/**
 * Converts a die's (non-indexed) BufferGeometry into a cannon-es
 * ConvexPolyhedron: duplicate per-triangle vertices are deduped back into a
 * minimal vertex set (keyed by rounded coordinates) and every triangle is
 * re-expressed against those deduped indices. Cached per `cacheKey` since
 * every die of the same type/size shares an identical collision shape.
 */
export function convexShapeForGeometry(cacheKey, geometry) {
  if (shapeCache.has(cacheKey)) return shapeCache.get(cacheKey)

  const source = geometry.index ? geometry.toNonIndexed() : geometry
  const pos = source.attributes.position
  const triCount = pos.count / 3

  const vertexIndex = new Map()
  const vertices = []
  const faces = []
  const v = new THREE.Vector3()

  function dedupIndex(i) {
    v.fromBufferAttribute(pos, i)
    const key = `${v.x.toFixed(5)},${v.y.toFixed(5)},${v.z.toFixed(5)}`
    let idx = vertexIndex.get(key)
    if (idx === undefined) {
      idx = vertices.length
      vertexIndex.set(key, idx)
      vertices.push(new CANNON.Vec3(v.x, v.y, v.z))
    }
    return idx
  }

  for (let t = 0; t < triCount; t++) {
    faces.push([dedupIndex(t * 3), dedupIndex(t * 3 + 1), dedupIndex(t * 3 + 2)])
  }

  const shape = new CANNON.ConvexPolyhedron({ vertices, faces })
  shapeCache.set(cacheKey, shape)
  return shape
}

export function clearShapeCache() {
  shapeCache.clear()
}
