// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'

// jsdom has no SVG geometry (d3.pointer needs it), so the viewport stands in
// with a map as big as its image and a pointer that reads straight off the event.
vi.mock('@/composables/useMapViewport', () => ({
  useMapViewport: () => ({
    naturalWidth: ref(1400),
    naturalHeight: ref(1050),
    pointer: (event) => ({ x: event.clientX, y: event.clientY })
  })
}))
vi.mock('@/config/env', () => ({ apiUrl: '' }))

const BattlemapCanvas = (await import('@/components/BattlemapCanvas.vue')).default

const GRID = { type: 'square', size: 70, offset_x: 0, offset_y: 0, snap: true, visible: true, color: '#fff', opacity: 0.3, distance: 5, unit: 'ft', measure: 'grid' }
const TOKENS = [
  { id: 'orc', name: 'Orc', x: 2, y: 3, size: 1, image_url: '/api/observatory/images/1a2b3c4d-orc.png', meters: [{ name: 'HP', current: 3, max: 6, min: 0 }] },
  { id: 'dragon', name: 'Dragon', x: 6, y: 6, size: 3, hidden: true, color: '#a33a3a', meters: [] },
  { id: 'quiet', name: 'Bugboar 2', x: 1, y: 1 }
]

// In the document: a drag is followed on the window (composables/usePointerDrag.js).
let mounted = []
const mountCanvas = (props = {}) => {
  const wrapper = mount(BattlemapCanvas, {
    attachTo: document.body,
    props: { imageUrl: '/api/observatory/images/1a2b3c4d-cave.png', grid: GRID, tokens: TOKENS, editable: true, ...props }
  })
  mounted.push(wrapper)
  return wrapper
}
afterEach(() => {
  mounted.forEach((wrapper) => wrapper.unmount())
  mounted = []
})

const pointer = (type, x, y, init = {}) => new PointerEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, ...init })
const down = (wrapper, selector, x, y) => wrapper.find(selector).element.dispatchEvent(pointer('pointerdown', x, y))
// Moves are drawn once a frame.
const frame = () => new Promise((resolve) => requestAnimationFrame(resolve))

describe('BattlemapCanvas', () => {
  it('draws the map, its grid and a token for each of them, at their size and place', () => {
    const wrapper = mountCanvas()
    expect(wrapper.find('svg').attributes('viewBox')).toBe('0 0 1400 1050')
    expect(wrapper.find('pattern').attributes()).toMatchObject({ width: '70', height: '70' })
    const tokens = wrapper.findAll('.token')
    expect(tokens).toHaveLength(3)
    expect(tokens[0].attributes('transform')).toBe('translate(175, 245)') // cell (2,3) + half a cell
    expect(tokens[1].attributes('transform')).toBe('translate(525, 525)') // 3 cells wide, from (6,6)
    expect(Number(tokens[1].find('.token-body').attributes('r'))).toBeGreaterThan(Number(tokens[0].find('.token-body').attributes('r')))
  })

  it('leaves the grid out when it has none, or is not shown', () => {
    expect(mountCanvas({ grid: { ...GRID, type: 'none' } }).find('pattern').exists()).toBe(false)
    expect(mountCanvas({ grid: { ...GRID, visible: false } }).find('pattern').exists()).toBe(false)
  })

  it('shows a token\'s image, or its initials, and a name', () => {
    const wrapper = mountCanvas()
    const [orc, , quiet] = wrapper.findAll('.token')
    expect(orc.find('image').attributes('href')).toContain('orc.png')
    expect(quiet.find('image').exists()).toBe(false)
    expect(quiet.find('.token-initials').text()).toBe('B2')
    expect(orc.find('.token-label').text()).toBe('Orc')
  })

  it("turns a token's art by its rotation, not its name", () => {
    const tokens = [{ ...TOKENS[0], rotation: 90 }, TOKENS[2]]
    const [orc, quiet] = mountCanvas({ tokens }).findAll('.token')
    expect(orc.find('image').attributes('transform')).toBe('rotate(90)')
    expect(orc.find('.token-label').attributes('transform')).toBeUndefined()
    expect(quiet.find('.token-initials').attributes('transform')).toBeUndefined()
  })

  it('shows the counters a token carries as bars, by how full they are', () => {
    const wrapper = mountCanvas()
    const [orc, dragon] = wrapper.findAll('.token')
    const back = Number(orc.find('.meter-back').attributes('width'))
    expect(Number(orc.find('.meter-fill').attributes('width'))).toBeCloseTo(back / 2)
    expect(dragon.find('.meter').exists()).toBe(false)
  })

  it('marks hidden tokens, and the selected one', () => {
    const wrapper = mountCanvas({ selectedId: 'orc' })
    const [orc, dragon] = wrapper.findAll('.token')
    expect(dragon.classes()).toContain('hidden')
    expect(orc.classes()).toContain('selected')
    expect(orc.classes()).not.toContain('hidden')
  })

  it('has a place for what to do about a map with no image', () => {
    const wrapper = mount(BattlemapCanvas, {
      props: { imageUrl: null, grid: GRID },
      slots: { 'empty-actions': '<button class="choose">Choose</button>' }
    })
    expect(wrapper.find('svg').exists()).toBe(false)
    expect(wrapper.find('.choose').exists()).toBe(true)
  })

  describe('moving a token', () => {
    it('selects it, shares the path it is dragged along, and moves it where it is dropped, on a cell', async () => {
      const wrapper = mountCanvas()
      down(wrapper, '.token:nth-of-type(1)', 175, 245)
      expect(wrapper.emitted('select')[0]).toEqual(['orc'])
      const svg = wrapper.find('svg').element
      svg.dispatchEvent(pointer('pointermove', 400, 300))
      await frame()
      expect(wrapper.emitted('move')).toBeUndefined() // not until it is let go of
      expect(wrapper.emitted('measure').at(-1)).toEqual([{ points: [{ x: 2.5, y: 3.5 }, { x: 5.5, y: 4.5 }], token: 'orc', end: false }])
      svg.dispatchEvent(pointer('pointerup', 400, 300))
      expect(wrapper.emitted('move')).toEqual([['orc', { x: 5, y: 4 }]])
      expect(wrapper.emitted('measure').at(-1)[0].end).toBe(true)
    })

    it('Space adds a turn to the path, Backspace takes it back, and the distance counts every leg', async () => {
      const wrapper = mountCanvas()
      down(wrapper, '.token:nth-of-type(1)', 175, 245) // cell (2,3)
      window.dispatchEvent(pointer('pointermove', 175 + 70 * 3, 245)) // 3 cells right
      await frame()
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }))
      window.dispatchEvent(pointer('pointermove', 175 + 70 * 3, 245 + 70 * 4)) // then 4 down
      await frame()
      await wrapper.vm.$nextTick()
      expect(wrapper.find('.measure-label').text()).toBe('35 ft') // 3 + 4 cells, 5 ft each (not 4 straight)
      expect(wrapper.findAll('.measure-turn')).toHaveLength(1)
      expect(wrapper.emitted('measure').at(-1)[0].points).toHaveLength(3)

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace' }))
      await wrapper.vm.$nextTick()
      expect(wrapper.find('.measure-label').text()).toBe('20 ft')
      window.dispatchEvent(pointer('pointerup', 385, 525))
      expect(wrapper.emitted('move')).toEqual([['orc', { x: 5, y: 7 }]])
    })

    it('a second finger adds a turn too', async () => {
      const wrapper = mountCanvas()
      down(wrapper, '.token:nth-of-type(1)', 175, 245)
      window.dispatchEvent(pointer('pointermove', 385, 245))
      await frame()
      wrapper.find('svg').element.dispatchEvent(pointer('pointerdown', 600, 600, { pointerId: 9 }))
      await wrapper.vm.$nextTick()
      expect(wrapper.findAll('.measure-turn')).toHaveLength(1)
      expect(wrapper.emitted('select')).toHaveLength(1) // and selects nothing else
    })

    it('does not count a tiny wobble as a move, and still selects', () => {
      const wrapper = mountCanvas()
      down(wrapper, '.token:nth-of-type(1)', 175, 245)
      const svg = wrapper.find('svg').element
      svg.dispatchEvent(pointer('pointermove', 176, 246))
      svg.dispatchEvent(pointer('pointerup', 176, 246))
      expect(wrapper.emitted('move')).toBeUndefined()
      expect(wrapper.emitted('select')[0]).toEqual(['orc'])
    })

    it('keeps where it was grabbed, and goes where it is dropped when the grid does not snap', () => {
      const wrapper = mountCanvas({ grid: { ...GRID, snap: false } })
      down(wrapper, '.token:nth-of-type(1)', 150, 220) // 10 px in from the token's corner (140, 210)
      const svg = wrapper.find('svg').element
      svg.dispatchEvent(pointer('pointermove', 360, 310))
      svg.dispatchEvent(pointer('pointerup', 360, 310))
      expect(wrapper.emitted('move')[0][1]).toEqual({ x: 5, y: 4.29 }) // (360-10)/70, (310-10)/70 to a hundredth
    })

    it('leaves the token where it is while its ghost follows the pointer, then shows it where it was put', async () => {
      const wrapper = mountCanvas()
      down(wrapper, '.token:nth-of-type(1)', 175, 245)
      wrapper.find('svg').element.dispatchEvent(pointer('pointermove', 400, 300))
      await frame()
      await wrapper.vm.$nextTick()
      const orc = wrapper.findAll('.token')[0]
      expect(orc.attributes('transform')).toBe('translate(175, 245)')
      expect(orc.classes()).toContain('dragging')
      expect(wrapper.find('.token.ghost').attributes('transform')).toBe('translate(385, 315)')

      window.dispatchEvent(pointer('pointerup', 400, 300))
      await wrapper.vm.$nextTick()
      expect(wrapper.find('.token.ghost').exists()).toBe(false)
      // It walks there from where it stood, then stays there before anyone has agreed.
      expect(wrapper.findAll('.token')[0].attributes('transform')).not.toBe('translate(385, 315)')
      await new Promise((resolve) => setTimeout(resolve, 600)) // 3 cells and one down: ~440 ms
      await wrapper.vm.$nextTick()
      expect(wrapper.findAll('.token')[0].attributes('transform')).toBe('translate(385, 315)')
    })

    it('lets a screen only look', () => {
      const wrapper = mountCanvas({ editable: false })
      down(wrapper, '.token:nth-of-type(1)', 175, 245)
      const svg = wrapper.find('svg').element
      svg.dispatchEvent(pointer('pointermove', 400, 300))
      svg.dispatchEvent(pointer('pointerup', 400, 300))
      expect(wrapper.emitted('move')).toBeUndefined()
      expect(wrapper.emitted('measure')).toBeUndefined()
    })

    it('counts the wobble in pixels of the screen, so a tap on a big map shown small still only selects', () => {
      // The threshold is read off the events' screen coordinates, never the
      // map's (usePointerDrag.test.js has a map drawn ten times smaller).
      const wrapper = mountCanvas()
      down(wrapper, '.token:nth-of-type(1)', 175, 245)
      window.dispatchEvent(pointer('pointermove', 178, 245))
      window.dispatchEvent(pointer('pointerup', 178, 245))
      expect(wrapper.emitted('measure')).toBeUndefined()
      expect(wrapper.emitted('move')).toBeUndefined()
    })

    it('only drags with the primary button', () => {
      const wrapper = mountCanvas()
      wrapper.find('.token:nth-of-type(1)').element.dispatchEvent(pointer('pointerdown', 175, 245, { button: 2 }))
      window.dispatchEvent(pointer('pointermove', 400, 300))
      window.dispatchEvent(pointer('pointerup', 400, 300))
      expect(wrapper.emitted('select')[0]).toEqual(['orc'])
      expect(wrapper.emitted('move')).toBeUndefined()
    })

    it('does not let a second finger take the drag over', () => {
      const wrapper = mountCanvas()
      down(wrapper, '.token:nth-of-type(1)', 175, 245)
      window.dispatchEvent(pointer('pointermove', 400, 300, { pointerId: 7 }))
      window.dispatchEvent(pointer('pointerup', 400, 300, { pointerId: 7 }))
      expect(wrapper.emitted('move')).toBeUndefined()
      window.dispatchEvent(pointer('pointermove', 400, 300))
      window.dispatchEvent(pointer('pointerup', 400, 300))
      expect(wrapper.emitted('move')).toEqual([['orc', { x: 5, y: 4 }]])
    })

    it('moves nothing when the browser cancels the gesture, and says the path is over', async () => {
      const wrapper = mountCanvas()
      down(wrapper, '.token:nth-of-type(1)', 175, 245)
      window.dispatchEvent(pointer('pointermove', 400, 300))
      await frame()
      window.dispatchEvent(pointer('pointercancel', 400, 300))
      await wrapper.vm.$nextTick()
      expect(wrapper.emitted('move')).toBeUndefined()
      expect(wrapper.emitted('measure').at(-1)[0].end).toBe(true)
      expect(wrapper.findAll('.token')[0].attributes('transform')).toBe('translate(175, 245)')
      expect(wrapper.find('.token.ghost').exists()).toBe(false)
    })

    it('clears the selection on the bare map', () => {
      const wrapper = mountCanvas({ selectedId: 'orc' })
      wrapper.find('svg').element.dispatchEvent(pointer('pointerdown', 900, 900))
      expect(wrapper.emitted('select')).toEqual([[null]])
    })
  })

  describe('the ruler', () => {
    it('measures between cell centres, as the table counts it, and does not move tokens', async () => {
      const wrapper = mountCanvas({ tool: 'ruler' })
      const svg = wrapper.find('svg').element
      svg.dispatchEvent(pointer('pointerdown', 40, 40)) // cell (0,0)
      svg.dispatchEvent(pointer('pointermove', 40 + 70 * 3, 40 + 70 * 2)) // cell (3,2)
      await frame()
      await wrapper.vm.$nextTick()
      expect(wrapper.find('.measure-label').text()).toBe('15 ft') // 3 cells by grid, 5 ft each
      svg.dispatchEvent(pointer('pointerup', 250, 180))
      expect(wrapper.find('.measure').exists()).toBe(true) // stays until the next one
      expect(wrapper.emitted('measure').at(-1)).toEqual([{ points: [{ x: 0.5, y: 0.5 }, { x: 3.5, y: 2.5 }], token: null, end: true }])
      expect(wrapper.emitted('move')).toBeUndefined()
      expect(wrapper.emitted('select')).toBeUndefined()
    })

    it('goes away when the tool changes', async () => {
      const wrapper = mountCanvas({ tool: 'ruler' })
      const svg = wrapper.find('svg').element
      svg.dispatchEvent(pointer('pointerdown', 40, 40))
      svg.dispatchEvent(pointer('pointermove', 200, 40))
      await wrapper.vm.$nextTick()
      await wrapper.setProps({ tool: 'select' })
      expect(wrapper.find('.measure').exists()).toBe(false)
    })

    it('names the range band a distance falls in, with its rings, on a map measured in bands', async () => {
      const bands = [{ name: 'Melee', max: 5 }, { name: 'Close', max: 30 }, { name: 'Far', max: null }]
      const wrapper = mountCanvas({ tool: 'ruler', grid: { ...GRID, measure: 'bands', bands } })
      const svg = wrapper.find('svg').element
      svg.dispatchEvent(pointer('pointerdown', 40, 40))
      svg.dispatchEvent(pointer('pointermove', 40 + 70 * 3, 40 + 70 * 4)) // 5 cells straight, 25 ft
      await frame()
      await wrapper.vm.$nextTick()
      expect(wrapper.find('.measure-label').text()).toBe('Close')
      expect(wrapper.findAll('.band-ring').map((r) => r.attributes('r'))).toEqual(['70', '420']) // 1 and 6 cells
      expect(wrapper.find('.band.current .band-name').text()).toBe('Close')
    })
  })

  describe('areas', () => {
    const AREAS = [
      { id: 'fire', shape: 'circle', x: 2, y: 2, size: 2, angle: 0, spread: 60, width: 1, color: '#f97316', label: 'Fireball' },
      { id: 'mist', shape: 'square', x: 6, y: 6, size: 1, angle: 0, spread: 60, width: 1, hidden: true, label: '' }
    ]

    it('draws each with its reach, the hidden ones marked', () => {
      const wrapper = mountCanvas({ areas: AREAS })
      const areas = wrapper.findAll('.area')
      expect(areas).toHaveLength(2)
      expect(areas[0].find('.area-label').text()).toBe('Fireball · 10 ft')
      expect(areas[1].classes()).toContain('hidden')
      expect(areas[1].find('.area-label').text()).toBe('10 ft') // a square's side
    })

    it('draws a new one by dragging from where it starts, on a cell, with the area tool', async () => {
      const wrapper = mountCanvas({ tool: 'area', areaShape: 'cone' })
      const svg = wrapper.find('svg').element
      svg.dispatchEvent(pointer('pointerdown', 140, 140)) // the corner of cell (2,2)
      svg.dispatchEvent(pointer('pointermove', 140 + 70 * 4, 140))
      await frame()
      await wrapper.vm.$nextTick()
      expect(wrapper.find('.area.preview').exists()).toBe(true)
      svg.dispatchEvent(pointer('pointerup', 140 + 70 * 4, 140))
      expect(wrapper.emitted('add-area')).toEqual([[{ shape: 'cone', x: 2, y: 2, size: 4, angle: 0 }]])
      await wrapper.vm.$nextTick()
      expect(wrapper.find('.area.preview').exists()).toBe(false)
    })

    it('selects one by its outline or origin and moves it by its origin', async () => {
      const wrapper = mountCanvas({ areas: AREAS })
      wrapper.find('.area-handle').element.dispatchEvent(pointer('pointerdown', 140, 140))
      expect(wrapper.emitted('select-area')).toEqual([['fire']])
      window.dispatchEvent(pointer('pointermove', 140 + 70 * 2 + 30, 140))
      await frame()
      window.dispatchEvent(pointer('pointerup', 140 + 70 * 2 + 30, 140))
      expect(wrapper.emitted('move-area')).toEqual([['fire', { x: 4.5, y: 2 }]]) // on a cell's centre or corner
    })

    it('once selected, is picked up by its inside too, and shows where it has been moved until agreed', async () => {
      const wrapper = mountCanvas({ areas: AREAS, selectedAreaId: 'fire' })
      wrapper.find('.area.selected .area-fill').element.dispatchEvent(pointer('pointerdown', 175, 140)) // half a cell in
      window.dispatchEvent(pointer('pointermove', 175 + 70 * 3, 140 + 70))
      await frame()
      window.dispatchEvent(pointer('pointerup', 175 + 70 * 3, 140 + 70))
      await wrapper.vm.$nextTick()
      expect(wrapper.emitted('move-area')).toEqual([['fire', { x: 5, y: 3 }]]) // the grab is kept
      expect(wrapper.find('.area.selected .area-handle').attributes('cx')).toBe('350')
    })

    it('resizes and turns the selected one by its reach handle', async () => {
      const cone = { ...AREAS[0], shape: 'cone', size: 2, angle: 0 }
      const wrapper = mountCanvas({ areas: [cone], selectedAreaId: 'fire' })
      const reach = wrapper.find('.area-reach')
      expect([reach.attributes('cx'), reach.attributes('cy')]).toEqual(['280', '140']) // its tip, 2 cells right
      reach.element.dispatchEvent(pointer('pointerdown', 280, 140))
      window.dispatchEvent(pointer('pointermove', 140, 140 + 70 * 4)) // 4 cells straight down
      await frame()
      window.dispatchEvent(pointer('pointerup', 140, 140 + 70 * 4))
      expect(wrapper.emitted('reshape-area')).toEqual([['fire', { size: 4, angle: 90 }]])
      expect(wrapper.emitted('move-area')).toBeUndefined()
    })

    it('shows no reach handle on what is not selected', () => {
      expect(mountCanvas({ areas: AREAS }).find('.area-reach').exists()).toBe(false)
    })

    it('lets a screen only look', () => {
      const wrapper = mountCanvas({ areas: AREAS, editable: false })
      expect(wrapper.find('.area-handle').exists()).toBe(false)
    })
  })

  describe('pointing', () => {
    it('a tap with the pointer pings where it landed, in cells', () => {
      const wrapper = mountCanvas({ tool: 'pointer' })
      const svg = wrapper.find('svg').element
      svg.dispatchEvent(pointer('pointerdown', 175, 245))
      svg.dispatchEvent(pointer('pointerup', 176, 245))
      expect(wrapper.emitted('ping')).toEqual([[{ x: 2.5, y: 3.5 }]])
      expect(wrapper.emitted('point')).toBeUndefined()
    })

    it('a drag is the laser: where it goes, then let go of; tokens are not moved', async () => {
      const wrapper = mountCanvas({ tool: 'pointer' })
      const svg = wrapper.find('svg').element
      svg.dispatchEvent(pointer('pointerdown', 0, 0))
      svg.dispatchEvent(pointer('pointermove', 140, 70))
      await frame()
      svg.dispatchEvent(pointer('pointerup', 140, 70))
      expect(wrapper.emitted('point')).toEqual([[{ x: 2, y: 1 }]])
      expect(wrapper.emitted('release')).toEqual([[]])
      expect(wrapper.emitted('ping')).toBeUndefined()
      expect(wrapper.emitted('move')).toBeUndefined()
    })

    it('a double click on the bare map pings; on a token, opens whoever it stands for', () => {
      const wrapper = mountCanvas()
      wrapper.find('svg').element.dispatchEvent(new MouseEvent('dblclick', { clientX: 35, clientY: 35, bubbles: true }))
      expect(wrapper.emitted('ping')).toEqual([[{ x: 0.5, y: 0.5 }]])
      wrapper.findAll('.token')[0].element.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
      expect(wrapper.emitted('open')).toEqual([['orc']])
      expect(wrapper.emitted('ping')).toHaveLength(1) // the token's double click is its own
    })

    it('draws the signals it is given over the map', async () => {
      const { createSignalLayer } = await import('@/utils/mapSignals')
      const layer = createSignalLayer()
      layer.receive({ kind: 'ping', points: [{ x: 1, y: 1 }], by: 'Leo' })
      layer.receive({ kind: 'roll', token: 'orc', roll: { label: 'Bite', formula: '1d6', total: 5 } })
      const wrapper = mountCanvas({ signals: layer })
      await frame()
      await wrapper.vm.$nextTick()
      expect(wrapper.find('.ping').attributes('transform')).toBe('translate(70, 70)')
      expect(wrapper.find('.ping .signal-name').text()).toBe('Leo')
      expect(wrapper.find('.roll').text()).toContain('Bite')
      expect(wrapper.find('.roll .roll-total').text()).toBe('5')
    })
  })
})
