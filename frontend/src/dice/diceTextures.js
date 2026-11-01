import * as THREE from 'three'
import { D4_FACE_UVS } from './diceGeometries'

const DEFAULT_THEME = {
  bg: '#241b4d',
  fg: '#f0f0ff',
  accent: 'rgba(199, 178, 255, 0.55)'
}

function toTexture(canvas) {
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  return texture
}

/**
 * A d4 face: three numbers, one beside each corner and turned so its top
 * points at that corner - whichever corner ends up as the die's apex shows
 * its number upright on all three visible faces. `labels` and the corner
 * positions follow D4_FACE_UVS's [apex, bottom-left, bottom-right] order.
 */
function createCornerFaceTexture(labels, theme) {
  const { bg, fg, accent } = { ...DEFAULT_THEME, ...theme }
  const size = 512
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')

  ctx.fillStyle = bg
  ctx.fillRect(0, 0, size, size)

  // Canvas y runs down while UV v runs up, hence the 1 - v.
  const corners = D4_FACE_UVS.map(([u, v]) => [u * size, (1 - v) * size])
  const cx = (corners[0][0] + corners[1][0] + corners[2][0]) / 3
  const cy = (corners[0][1] + corners[1][1] + corners[2][1]) / 3

  ctx.strokeStyle = accent
  ctx.lineWidth = size * 0.03
  ctx.lineJoin = 'round'
  ctx.beginPath()
  corners.forEach(([x, y], i) => {
    const ix = cx + (x - cx) * 0.9
    const iy = cy + (y - cy) * 0.9
    if (i === 0) ctx.moveTo(ix, iy)
    else ctx.lineTo(ix, iy)
  })
  ctx.closePath()
  ctx.stroke()

  const fontSize = size * 0.2
  ctx.fillStyle = fg
  ctx.font = `700 ${fontSize}px 'Segoe UI', system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  corners.forEach(([x, y], i) => {
    const dx = x - cx
    const dy = y - cy
    ctx.save()
    ctx.translate(cx + dx * 0.55, cy + dy * 0.55)
    ctx.rotate(Math.atan2(dx, -dy))
    ctx.fillText(labels[i], 0, fontSize * 0.04)
    ctx.restore()
  })

  return toTexture(canvas)
}

/**
 * Draws a single face's printed label onto an offscreen canvas and returns
 * it as a CanvasTexture. `label` may be null for an unlabeled face (e.g. the
 * cylindrical edge of the d2 coin), or an array of three for a d4 face.
 */
export function createFaceTexture(label, theme = {}) {
  if (Array.isArray(label)) return createCornerFaceTexture(label, theme)
  const { bg, fg, accent } = { ...DEFAULT_THEME, ...theme }
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')

  ctx.fillStyle = bg
  ctx.fillRect(0, 0, size, size)

  if (label != null) {
    ctx.strokeStyle = accent
    ctx.lineWidth = size * 0.045
    ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, size - ctx.lineWidth, size - ctx.lineWidth)

    ctx.fillStyle = fg
    const fontSize = label.length > 2 ? size * 0.34 : size * 0.46
    ctx.font = `700 ${fontSize}px 'Segoe UI', system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(label), size / 2, size / 2 + fontSize * 0.04)
  }

  return toTexture(canvas)
}

/**
 * Builds one MeshStandardMaterial per label (in material-group order).
 * `labels[i] === null` produces a plain themed material with no numeral,
 * used for a die's unlabeled faces (the coin's edge band).
 */
export function buildFaceMaterials(labels, theme = {}) {
  return labels.map(label => new THREE.MeshStandardMaterial({
    map: createFaceTexture(label, theme),
    roughness: 0.45,
    metalness: 0.08
  }))
}
