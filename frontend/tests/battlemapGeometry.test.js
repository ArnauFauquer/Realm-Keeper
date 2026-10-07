import { describe, it, expect } from 'vitest'
import {
  areaFromDrag, areaLabelPoint, areaMeasure, areaPath, bandFor, bandRings, cellCenter, freeCells, initials, measure,
  measurePath, meterFill, snapPosition, toCells, toPixels, tokenCenter, tokenImageFrame
} from '@/utils/battlemapGeometry'

const GRID = { type: 'square', size: 50, offset_x: 10, offset_y: 20, snap: true, distance: 5, unit: 'ft', measure: 'grid' }

describe('cells and pixels', () => {
  it('convert both ways, through the grid offset', () => {
    expect(toPixels(GRID, 2, 3)).toEqual({ x: 110, y: 170 })
    expect(toCells(GRID, 110, 170)).toEqual({ x: 2, y: 3 })
    expect(toCells(GRID, toPixels(GRID, 1.5, 0.25).x, toPixels(GRID, 1.5, 0.25).y)).toEqual({ x: 1.5, y: 0.25 })
  })

  it('give a token\'s centre by its size', () => {
    expect(tokenCenter(GRID, { x: 2, y: 3, size: 1 })).toEqual({ x: 135, y: 195 })
    expect(tokenCenter(GRID, { x: 2, y: 3, size: 3 })).toEqual({ x: 185, y: 245 })
    expect(tokenCenter(GRID, { x: 0, y: 0 })).toEqual({ x: 35, y: 45 })
  })

  it('find the centre of the cell a point is in', () => {
    expect(cellCenter(GRID, 12, 22)).toEqual({ x: 35, y: 45 })
    expect(cellCenter(GRID, 59, 69)).toEqual({ x: 35, y: 45 })
    expect(cellCenter(GRID, 61, 69)).toEqual({ x: 85, y: 45 })
    expect(cellCenter({ ...GRID, type: 'none' }, 12, 22)).toEqual({ x: 12, y: 22 })
  })
})

describe('snapPosition', () => {
  it('lands on a cell when the grid snaps', () => {
    expect(snapPosition(GRID, 2.4, 3.6)).toEqual({ x: 2, y: 4 })
    expect(snapPosition(GRID, -0.6, 0.4)).toEqual({ x: -1, y: 0 })
  })

  it('goes wherever it is dropped when it does not, to a hundredth of a cell', () => {
    expect(snapPosition({ ...GRID, snap: false }, 2.456, 3.001)).toEqual({ x: 2.46, y: 3 })
    expect(snapPosition({ ...GRID, type: 'none' }, 2.4, 3.6)).toEqual({ x: 2.4, y: 3.6 })
  })
})

describe('measure', () => {
  const at = (x, y) => toPixels(GRID, x, y)

  it('counts a diagonal step as one cell on a grid, and is worth what the table says', () => {
    const m = measure(GRID, at(0, 0), at(3, 4))
    expect(m.cells).toBe(4)
    expect(m.distance).toBe(20)
    expect(m.label).toBe('20 ft')
  })

  it('measures the line when asked to', () => {
    const m = measure({ ...GRID, measure: 'straight', distance: 1.5, unit: 'm' }, at(0, 0), at(3, 4))
    expect(m.cells).toBe(5)
    expect(m.label).toBe('7.5 m')
  })

  it('shows a distance without trailing noise', () => {
    expect(measure({ ...GRID, distance: 1, unit: 'cell' }, at(0, 0), at(2, 0)).label).toBe('2 cell')
    expect(measure({ ...GRID, measure: 'straight', distance: 1, unit: 'sq' }, at(0, 0), at(1, 1)).label).toBe('1.4 sq')
  })
})

describe('freeCells', () => {
  it('fills rows from the top left', () => {
    expect(freeCells(3, [], 2)).toEqual([{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 2 }])
  })

  it('skips the cells under tokens already there, big ones included', () => {
    const tokens = [{ x: 1, y: 1, size: 2 }, { x: 3, y: 1, size: 1 }]
    // (1,1) (2,1) (1,2) (2,2) are under the big one, (3,1) under the other
    expect(freeCells(2, tokens, 4)).toEqual([{ x: 4, y: 1 }, { x: 3, y: 2 }])
  })
})

describe('initials', () => {
  it('abbreviates a name for a token without an image', () => {
    expect(initials('Bugboar 2')).toBe('B2')
    expect(initials('Aria Stormwind')).toBe('AS')
    expect(initials('Orc')).toBe('Or')
    expect(initials('  ')).toBe('?')
  })
})

describe('meterFill', () => {
  it('is how far a counter is from its minimum to its maximum', () => {
    expect(meterFill({ current: 3, max: 6, min: 0 })).toBe(0.5)
    expect(meterFill({ current: 2, max: 6, min: 2 })).toBe(0)
    expect(meterFill({ current: 9, max: 6 })).toBe(1)
    expect(meterFill({ current: 1, max: 0 })).toBe(0)
  })
})

describe('measurePath', () => {
  const at = (x, y) => toPixels(GRID, x, y)

  it('adds up every leg of a path with turns, each counted as the map counts', () => {
    // 3 right then 4 down: 7 cells by grid, 7 by the line too (each leg is straight).
    expect(measurePath(GRID, [at(0, 0), at(3, 0), at(3, 4)]).cells).toBe(7)
    expect(measurePath({ ...GRID, measure: 'straight' }, [at(0, 0), at(3, 0), at(3, 4)]).cells).toBe(7)
    // A diagonal leg: one cell a step by grid, its length by the line.
    expect(measurePath(GRID, [at(0, 0), at(2, 2), at(2, 5)]).cells).toBe(5)
    expect(measurePath(GRID, [at(1, 1)]).cells).toBe(0)
  })

  it('names the band a distance falls in, on a map measured in bands', () => {
    const bands = [{ name: 'Melee', max: 5 }, { name: 'Close', max: 30 }, { name: 'Far', max: null }]
    const grid = { ...GRID, measure: 'bands', bands }
    expect(measurePath(grid, [at(0, 0), at(1, 0)]).label).toBe('Melee') // 5 ft: still in reach
    expect(measurePath(grid, [at(0, 0), at(3, 4)]).label).toBe('Close') // 25 ft, measured straight
    const far = measurePath(grid, [at(0, 0), at(20, 0)])
    expect([far.label, far.distance]).toEqual(['Far', 100])
    expect(measurePath({ ...grid, bands: [] }, [at(0, 0), at(1, 0)]).label).toBe('5 ft') // no bands yet
  })
})

describe('bands', () => {
  it('a distance beyond every reach falls in the last band', () => {
    expect(bandFor([{ name: 'A', max: 1 }, { name: 'B', max: 2 }], 9).name).toBe('B')
    expect(bandFor([], 3)).toBeNull()
  })

  it('draws a ring per band with a reach, in pixels', () => {
    const grid = { ...GRID, measure: 'bands', bands: [{ name: 'Near', max: 10 }, { name: 'Far', max: null }] }
    expect(bandRings(grid)).toEqual([{ name: 'Near', r: 100 }]) // 10 ft = 2 cells of 50 px
    expect(bandRings({ ...grid, measure: 'grid' })).toEqual([])
  })
})

describe('areas', () => {
  const area = (fields) => ({ x: 2, y: 2, size: 2, angle: 0, spread: 60, width: 1, ...fields })
  const G = { ...GRID, offset_x: 0, offset_y: 0 }

  it('outlines each shape from its origin', () => {
    expect(areaPath(G, area({ shape: 'circle' }))).toBe('M 0 100 a 100 100 0 1 0 200 0 a 100 100 0 1 0 -200 0 Z')
    expect(areaPath(G, area({ shape: 'square', size: 1 }))).toBe('M 50 50 h 100 v 100 h -100 Z')
    expect(areaPath(G, area({ shape: 'line', width: 1 }))).toBe('M 100 125 L 200 125 L 200 75 L 100 75 Z')
    const cone = areaPath(G, area({ shape: 'cone', spread: 90 }))
    expect(cone.startsWith('M 100 100 L 170.71 29.29 A 100 100 0 0 1 170.71 170.71')).toBe(true)
    expect(areaPath(G, area({ shape: 'cone', spread: 360 }))).toBe(areaPath(G, area({ shape: 'circle' })))
  })

  it('says what it reaches as the table counts it', () => {
    expect(areaMeasure(GRID, area({ shape: 'circle' }))).toBe('10 ft')
    expect(areaMeasure(GRID, area({ shape: 'square', size: 1 }))).toBe('10 ft') // its side
    expect(areaMeasure(GRID, area({ shape: 'line', size: 6 }))).toBe('30 ft × 5 ft')
    const bands = { ...GRID, measure: 'bands', bands: [{ name: 'Close', max: 15 }, { name: 'Far' }] }
    expect(areaMeasure(bands, area({ shape: 'cone', size: 6 }))).toBe('Far')
  })

  it('labels a cone or line along it, the rest at their origin', () => {
    expect(areaLabelPoint(G, area({ shape: 'circle' }))).toEqual({ x: 100, y: 100 })
    expect(areaLabelPoint(G, area({ shape: 'line', angle: 90 })).y).toBeCloseTo(150)
  })

  it('is drawn from a drag: snapped on a grid that snaps, free otherwise', () => {
    expect(areaFromDrag(GRID, 'circle', { x: 2.2, y: 2.4 }, { x: 5.4, y: 2.5 })).toEqual({ shape: 'circle', x: 2, y: 2.5, size: 3, angle: 0 })
    expect(areaFromDrag(GRID, 'cone', { x: 2, y: 2 }, { x: 2, y: 6 }).angle).toBe(90)
    expect(areaFromDrag(GRID, 'square', { x: 2, y: 2 }, { x: 3.2, y: 2.1 }).size).toBe(1)
    expect(areaFromDrag(GRID, 'circle', { x: 2, y: 2 }, { x: 2.1, y: 2 }).size).toBe(1) // never nothing
    const free = areaFromDrag({ ...GRID, snap: false }, 'line', { x: 2.123, y: 2 }, { x: 4.5, y: 2 })
    expect(free).toEqual({ shape: 'line', x: 2.12, y: 2, size: 2.38, angle: 0 })
  })
})

describe('tokenImageFrame', () => {
  it('fills the token by default, and is zoomed and moved as the token says', () => {
    expect(tokenImageFrame({}, 50)).toEqual({ x: -50, y: -50, size: 100 })
    expect(tokenImageFrame({ image_scale: 2, image_x: 0.25, image_y: -0.1 }, 50)).toEqual({ x: -75, y: -110, size: 200 })
  })
})
