// Where things are on a battlemap. Tokens are placed and sized in cells (a
// token's x, y is the corner of the cell it stands on, its top left), so that
// changing the grid's size never moves anyone; the map itself is drawn in
// pixels of its image. A grid is { size, offset_x, offset_y, type, snap,
// distance, unit, measure, bands } (see backend models/battlemap.py).

/** A point in cells -> pixels of the map image. */
export function toPixels(grid, x, y) {
  return { x: grid.offset_x + x * grid.size, y: grid.offset_y + y * grid.size }
}

/** A point in pixels of the map image -> cells. */
export function toCells(grid, px, py) {
  return { x: (px - grid.offset_x) / grid.size, y: (py - grid.offset_y) / grid.size }
}

/** Where a token lands when dropped at (x, y) cells: on a cell if the grid
 * snaps, otherwise wherever, to a hundredth of a cell. */
export function snapPosition(grid, x, y) {
  if (grid.type === 'square' && grid.snap) return { x: Math.round(x), y: Math.round(y) }
  return { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 }
}

/** The centre of a token, in pixels of the map image. */
export function tokenCenter(grid, token) {
  const half = (token.size ?? 1) / 2
  return toPixels(grid, token.x + half, token.y + half)
}

/** The centre of the cell a point (in pixels) is in, or the point itself when
 * the grid has no cells to speak of. */
export function cellCenter(grid, px, py) {
  if (grid.type !== 'square') return { x: px, y: py }
  const cell = toCells(grid, px, py)
  return toPixels(grid, Math.floor(cell.x) + 0.5, Math.floor(cell.y) + 0.5)
}

const trim = (number) => String(Math.round(number * 10) / 10)

/** A distance as the table says it: "7.5 m". */
export const formatDistance = (grid, distance) => `${trim(distance)} ${grid.unit}`

/** The range band a distance (in the grid's unit) falls in: the first that
 * reaches it, or the last one (anything further); null without bands. */
export function bandFor(bands, distance) {
  if (!bands?.length) return null
  const reaches = (band) => band.max === null || band.max === undefined || distance <= band.max + 1e-9
  return bands.find(reaches) || bands[bands.length - 1]
}

// One leg's length in cells: by grid a diagonal step costs one cell; any
// other way, the line's own length.
function legCells(grid, a, b) {
  const dx = Math.abs(b.x - a.x)
  const dy = Math.abs(b.y - a.y)
  return grid.measure === 'grid' ? Math.max(dx, dy) : Math.hypot(dx, dy)
}

/**
 * How far it is along a path of points (in pixels: where it starts, each
 * turn, where it ends), as the table counts it: `cells`, what that is worth
 * (`distance`, in the grid's `unit`), the range `band` it falls in when the
 * map measures in bands, and a `label` to show (the band's name, or the
 * distance). By grid a diagonal step costs one cell; "straight" and "bands"
 * measure the line.
 */
export function measurePath(grid, points) {
  let cells = 0
  for (let i = 1; i < points.length; i++) {
    cells += legCells(grid, toCells(grid, points[i - 1].x, points[i - 1].y), toCells(grid, points[i].x, points[i].y))
  }
  const distance = cells * grid.distance
  const band = grid.measure === 'bands' ? bandFor(grid.bands, distance) : null
  return { cells, distance, band, label: band ? band.name : formatDistance(grid, distance) }
}

/** measurePath of a straight line between two points (in pixels). */
export const measure = (grid, from, to) => measurePath(grid, [from, to])

/** The rings a map measured in bands draws around a point (in pixels): one
 * per band with a reach, { name, r } with r in pixels. */
export function bandRings(grid) {
  if (grid.measure !== 'bands') return []
  return (grid.bands || []).filter((band) => band.max).map((band) => ({ name: band.name, r: (band.max / grid.distance) * grid.size }))
}

// ── areas ──────────────────────────────────────────────────────────────────

const rad = (degrees) => (degrees * Math.PI) / 180
const r2 = (n) => Math.round(n * 100) / 100

const circlePath = (o, r) =>
  `M ${r2(o.x - r)} ${r2(o.y)} a ${r2(r)} ${r2(r)} 0 1 0 ${r2(r * 2)} 0 a ${r2(r)} ${r2(r)} 0 1 0 ${r2(-r * 2)} 0 Z`

/**
 * The outline of an area (backend models/battlemap.py Area) as SVG path
 * data, in pixels: a `circle` around its origin, a `cone` from it, a `line`
 * along it, a `square` around it.
 */
export function areaPath(grid, area) {
  const o = toPixels(grid, area.x, area.y)
  const size = area.size * grid.size
  const angle = rad(area.angle || 0)
  if (area.shape === 'cone') {
    const half = rad(Math.min(360, area.spread ?? 60)) / 2
    if (half >= Math.PI - 1e-6) return circlePath(o, size)
    const p1 = { x: o.x + size * Math.cos(angle - half), y: o.y + size * Math.sin(angle - half) }
    const p2 = { x: o.x + size * Math.cos(angle + half), y: o.y + size * Math.sin(angle + half) }
    const large = half * 2 > Math.PI ? 1 : 0
    return `M ${r2(o.x)} ${r2(o.y)} L ${r2(p1.x)} ${r2(p1.y)} A ${r2(size)} ${r2(size)} 0 ${large} 1 ${r2(p2.x)} ${r2(p2.y)} Z`
  }
  if (area.shape === 'line') {
    const w = ((area.width ?? 1) * grid.size) / 2
    const [dx, dy] = [Math.cos(angle), Math.sin(angle)]
    const [nx, ny] = [-dy * w, dx * w]
    const end = { x: o.x + dx * size, y: o.y + dy * size }
    const corners = [[o.x + nx, o.y + ny], [end.x + nx, end.y + ny], [end.x - nx, end.y - ny], [o.x - nx, o.y - ny]]
    return `M ${corners.map(([x, y]) => `${r2(x)} ${r2(y)}`).join(' L ')} Z`
  }
  if (area.shape === 'square') {
    return `M ${r2(o.x - size)} ${r2(o.y - size)} h ${r2(size * 2)} v ${r2(size * 2)} h ${r2(-size * 2)} Z`
  }
  return circlePath(o, size)
}

/** Where an area's reach handle sits (pixels): at the end of a cone or
 * line, on a circle's edge the way it was drawn, at a square's corner. */
export function areaReachPoint(grid, area) {
  const o = toPixels(grid, area.x, area.y)
  const size = area.size * grid.size
  if (area.shape === 'square') return { x: o.x + size, y: o.y + size }
  const angle = rad(area.angle || 0)
  return { x: o.x + size * Math.cos(angle), y: o.y + size * Math.sin(angle) }
}

/** Where an area's label goes (pixels): its origin, or along a cone or line. */
export function areaLabelPoint(grid, area) {
  const o = toPixels(grid, area.x, area.y)
  if (area.shape !== 'cone' && area.shape !== 'line') return o
  const along = area.size * grid.size * (area.shape === 'cone' ? 0.6 : 0.5)
  return { x: o.x + along * Math.cos(rad(area.angle || 0)), y: o.y + along * Math.sin(rad(area.angle || 0)) }
}

/** What an area measures, as the table says it: its reach (a square's
 * side), as a band's name on a map measured in bands, and a line's width. */
export function areaMeasure(grid, area) {
  const reach = (area.shape === 'square' ? area.size * 2 : area.size) * grid.distance
  const band = grid.measure === 'bands' ? bandFor(grid.bands, reach) : null
  const text = band ? band.name : formatDistance(grid, reach)
  return area.shape === 'line' ? `${text} × ${formatDistance(grid, (area.width ?? 1) * grid.distance)}` : text
}

/**
 * An area drawn by dragging from `origin` to `to` (both in cells): its
 * origin, reach and direction. On a grid that snaps, the origin lands on a
 * cell's centre or corner and the reach on whole cells (half cells for a
 * square, which reaches both ways); the direction stays free.
 */
export function areaFromDrag(grid, shape, origin, to) {
  const snaps = grid.type === 'square' && grid.snap
  const at = snaps ? { x: Math.round(origin.x * 2) / 2, y: Math.round(origin.y * 2) / 2 } : { x: r2(origin.x), y: r2(origin.y) }
  const dx = to.x - at.x
  const dy = to.y - at.y
  let size = shape === 'square' ? Math.max(Math.abs(dx), Math.abs(dy)) : Math.hypot(dx, dy)
  if (snaps) size = shape === 'square' ? Math.round(size * 2) / 2 : Math.round(size)
  const smallest = snaps ? (shape === 'square' ? 0.5 : 1) : 0.1
  return { shape, x: at.x, y: at.y, size: Math.max(smallest, r2(size)), angle: Math.round((Math.atan2(dy, dx) * 180) / Math.PI) }
}

/** `count` free cells to put new tokens in, filling rows left to right from
 * the top left, skipping cells under a token already there. */
export function freeCells(count, tokens, columns = 8) {
  const taken = new Set()
  for (const token of tokens) {
    const size = Math.max(1, Math.ceil(token.size ?? 1))
    for (let dx = 0; dx < size; dx++) {
      for (let dy = 0; dy < size; dy++) taken.add(`${Math.round(token.x) + dx},${Math.round(token.y) + dy}`)
    }
  }
  const cells = []
  for (let index = 0; cells.length < count; index++) {
    const x = 1 + (index % columns)
    const y = 1 + Math.floor(index / columns)
    if (!taken.has(`${x},${y}`)) cells.push({ x, y })
  }
  return cells
}

/** A token with no image shows its initials: "Bugboar 2" -> "B2". */
export function initials(name) {
  const words = (name || '').trim().split(/\s+/).filter(Boolean)
  if (!words.length) return '?'
  if (words.length === 1) return words[0].slice(0, 2)
  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}

/**
 * Where a token's image sits inside a token of radius `r` (pixels, around
 * its centre), whole and at its own proportions (`aspect`, its width over its
 * height): at `image_scale` 1 its shorter side spans the token, so it covers
 * it, and the rest of it reaches past, ready to be brought in by moving it
 * (`image_x`, `image_y`, in token widths). { x, y, width, height }.
 */
export function tokenImageFrame(token, r, aspect = 1) {
  const base = 2 * r * (token.image_scale ?? 1)
  const ratio = aspect > 0 && Number.isFinite(aspect) ? aspect : 1
  const width = ratio >= 1 ? base * ratio : base
  const height = ratio >= 1 ? base : base / ratio
  return {
    x: -width / 2 + (token.image_x ?? 0) * 2 * r,
    y: -height / 2 + (token.image_y ?? 0) * 2 * r,
    width,
    height
  }
}

/** How full a meter is, 0 to 1. */
export function meterFill(meter) {
  const span = meter.max - (meter.min ?? 0)
  return span > 0 ? Math.min(1, Math.max(0, (meter.current - (meter.min ?? 0)) / span)) : 0
}
