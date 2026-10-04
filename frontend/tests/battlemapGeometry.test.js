import { describe, it, expect } from 'vitest'
import {
  cellCenter, freeCells, initials, measure, meterFill, snapPosition, toCells, toPixels, tokenCenter
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
