// Where things are on a battlemap. Tokens are placed and sized in cells (a
// token's x, y is the corner of the cell it stands on, its top left), so that
// changing the grid's size never moves anyone; the map itself is drawn in
// pixels of its image. A grid is { size, offset_x, offset_y, type, snap,
// distance, unit, measure } (see backend models/battlemap.py).

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

/**
 * How far apart two points (in pixels) are, as the table counts it: `cells`,
 * what that is worth (`distance`, in the grid's `unit`) and a `label` to show.
 * By grid a diagonal step costs one cell; "straight" measures the line.
 */
export function measure(grid, from, to) {
  const a = toCells(grid, from.x, from.y)
  const b = toCells(grid, to.x, to.y)
  const dx = Math.abs(b.x - a.x)
  const dy = Math.abs(b.y - a.y)
  const cells = grid.measure === 'straight' ? Math.hypot(dx, dy) : Math.max(dx, dy)
  const distance = cells * grid.distance
  return { cells, distance, label: `${trim(distance)} ${grid.unit}` }
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

/** How full a meter is, 0 to 1. */
export function meterFill(meter) {
  const span = meter.max - (meter.min ?? 0)
  return span > 0 ? Math.min(1, Math.max(0, (meter.current - (meter.min ?? 0)) / span)) : 0
}
