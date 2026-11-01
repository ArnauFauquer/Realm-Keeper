// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { buildFaceMaterials, createFaceTexture } from '@/dice/diceTextures'

let ctx

beforeEach(() => {
  ctx = new Proxy({}, {
    get: (t, k) => (k in t ? t[k] : (t[k] = vi.fn())),
    set: (t, k, v) => { t[k] = v; return true }
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx)
})

describe('createFaceTexture', () => {
  it('prints a number in a framed square', () => {
    const texture = createFaceTexture('20')
    expect(texture).toBeInstanceOf(THREE.CanvasTexture)
    expect(texture.image.width).toBe(256)
    expect(ctx.strokeRect).toHaveBeenCalled()
    expect(ctx.fillText).toHaveBeenCalledWith('20', 128, expect.any(Number))
  })

  it('prints a long label smaller than a short one', () => {
    createFaceTexture('7')
    const short = parseFloat(ctx.font.match(/([\d.]+)px/)[1])
    createFaceTexture('100')
    const long = parseFloat(ctx.font.match(/([\d.]+)px/)[1])
    expect(long).toBeLessThan(short)
  })

  it('leaves an unlabelled face (the coin edge) plain', () => {
    createFaceTexture(null)
    expect(ctx.fillRect).toHaveBeenCalled()
    expect(ctx.fillText).not.toHaveBeenCalled()
    expect(ctx.strokeRect).not.toHaveBeenCalled()
  })

  it('uses the theme colours over the defaults', () => {
    createFaceTexture('1', { bg: '#111111' })
    expect(ctx.fillStyle).toBe('#f0f0ff')   // the last fill is the label, in the default fg
    expect(ctx.fillRect.mock.calls).toHaveLength(1)
  })

  it('writes the three numbers of a d4 face, one by each corner', () => {
    const texture = createFaceTexture(['1', '2', '3'])
    expect(texture.image.width).toBe(512)
    expect(ctx.fillText.mock.calls.map((c) => c[0])).toEqual(['1', '2', '3'])
    expect(ctx.rotate).toHaveBeenCalledTimes(3)
    expect(ctx.stroke).toHaveBeenCalled()
  })
})

describe('buildFaceMaterials', () => {
  it('makes one material per label, in order', () => {
    const materials = buildFaceMaterials(['1', null, '3'])
    expect(materials).toHaveLength(3)
    materials.forEach((m) => {
      expect(m).toBeInstanceOf(THREE.MeshStandardMaterial)
      expect(m.map).toBeInstanceOf(THREE.CanvasTexture)
    })
  })
})
