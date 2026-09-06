import * as THREE from 'three'

const DEFAULT_THEME = {
  bg: '#241b4d',
  fg: '#f0f0ff',
  accent: 'rgba(199, 178, 255, 0.55)'
}

/**
 * Draws a single face's printed label onto an offscreen canvas and returns
 * it as a CanvasTexture. `label` may be null for an unlabeled face (e.g. the
 * cylindrical edge of the d2 coin).
 */
export function createFaceTexture(label, theme = {}) {
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

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  return texture
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
