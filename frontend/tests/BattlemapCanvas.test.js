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
      slots: { empty: '<button class="choose">Choose</button>' }
    })
    expect(wrapper.find('svg').exists()).toBe(false)
    expect(wrapper.find('.choose').exists()).toBe(true)
  })

  describe('moving a token', () => {
    it('selects it, and reports where it goes as it is dragged and where it is dropped, on a cell', async () => {
      const wrapper = mountCanvas()
      down(wrapper, '.token:nth-of-type(1)', 175, 245)
      expect(wrapper.emitted('select')[0]).toEqual(['orc'])
      const svg = wrapper.find('svg').element
      svg.dispatchEvent(pointer('pointermove', 400, 300))
      svg.dispatchEvent(pointer('pointerup', 400, 300))
      expect(wrapper.emitted('moving').at(-1)).toEqual(['orc', { x: 5, y: 4 }])
      expect(wrapper.emitted('move')).toEqual([['orc', { x: 5, y: 4 }]])
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

    it('shows the token where it is being dragged, before anyone has agreed', async () => {
      const wrapper = mountCanvas()
      down(wrapper, '.token:nth-of-type(1)', 175, 245)
      wrapper.find('svg').element.dispatchEvent(pointer('pointermove', 400, 300))
      await frame()
      await wrapper.vm.$nextTick()
      expect(wrapper.findAll('.token')[0].attributes('transform')).toBe('translate(385, 315)')
      expect(wrapper.findAll('.token')[0].classes()).toContain('dragging')
    })

    it('lets a screen only look', () => {
      const wrapper = mountCanvas({ editable: false })
      down(wrapper, '.token:nth-of-type(1)', 175, 245)
      const svg = wrapper.find('svg').element
      svg.dispatchEvent(pointer('pointermove', 400, 300))
      svg.dispatchEvent(pointer('pointerup', 400, 300))
      expect(wrapper.emitted('move')).toBeUndefined()
      expect(wrapper.emitted('moving')).toBeUndefined()
    })

    it('counts the wobble in pixels of the screen, so a tap on a big map shown small still only selects', () => {
      // The threshold is read off the events' screen coordinates, never the
      // map's (usePointerDrag.test.js has a map drawn ten times smaller).
      const wrapper = mountCanvas()
      down(wrapper, '.token:nth-of-type(1)', 175, 245)
      window.dispatchEvent(pointer('pointermove', 178, 245))
      window.dispatchEvent(pointer('pointerup', 178, 245))
      expect(wrapper.emitted('moving')).toBeUndefined()
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

    it('puts the token back where it was when the browser cancels the gesture', async () => {
      const wrapper = mountCanvas()
      down(wrapper, '.token:nth-of-type(1)', 175, 245)
      window.dispatchEvent(pointer('pointermove', 400, 300))
      await frame()
      window.dispatchEvent(pointer('pointercancel', 400, 300))
      await wrapper.vm.$nextTick()
      // Everyone saw it move, so everyone is told it is back.
      expect(wrapper.emitted('move')).toEqual([['orc', { x: 2, y: 3 }]])
      expect(wrapper.findAll('.token')[0].attributes('transform')).toBe('translate(175, 245)')
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
      expect(wrapper.find('.ruler-label').text()).toBe('15 ft') // 3 cells by grid, 5 ft each
      svg.dispatchEvent(pointer('pointerup', 250, 180))
      expect(wrapper.find('.ruler').exists()).toBe(true) // stays until the next one
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
      expect(wrapper.find('.ruler').exists()).toBe(false)
    })
  })
})
