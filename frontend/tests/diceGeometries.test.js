import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { buildD4 } from '@/dice/diceGeometries'

describe('buildD4', () => {
  const { geometry, faceTable, materialLabels } = buildD4()
  const pos = geometry.attributes.position
  const vertexValue = new Map(faceTable.map(f => [f.localNormal.toArray().map(n => n.toFixed(3)).join(), f.value]))
  const valueAt = (i) => {
    const dir = new THREE.Vector3().fromBufferAttribute(pos, i).normalize()
    return vertexValue.get(dir.toArray().map(n => n.toFixed(3)).join())
  }

  it('prints, on every face, the value of the vertex beside each number', () => {
    expect(materialLabels).toHaveLength(4)
    for (let face = 0; face < 4; face++) {
      const corners = [0, 1, 2].map(c => String(valueAt(face * 3 + c)))
      expect(materialLabels[face]).toEqual(corners)
    }
  })

  it('winds every face outwards', () => {
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3()
    for (let face = 0; face < 4; face++) {
      a.fromBufferAttribute(pos, face * 3)
      b.fromBufferAttribute(pos, face * 3 + 1)
      c.fromBufferAttribute(pos, face * 3 + 2)
      const centroid = a.clone().add(b).add(c)
      const normal = b.clone().sub(a).cross(c.clone().sub(a))
      expect(normal.dot(centroid)).toBeGreaterThan(0)
    }
  })

  it('reads the top vertex when resting on the opposite face', () => {
    faceTable.forEach(top => {
      const quat = new THREE.Quaternion().setFromUnitVectors(top.localNormal, new THREE.Vector3(0, 1, 0))
      const read = faceTable.reduce((best, f) =>
        f.localNormal.clone().applyQuaternion(quat).y > best.localNormal.clone().applyQuaternion(quat).y ? f : best)
      expect(read.value).toBe(top.value)
    })
  })
})
