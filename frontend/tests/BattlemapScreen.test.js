// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'

vi.mock('@/composables/useMapViewport', () => ({
  useMapViewport: () => ({ naturalWidth: ref(1400), naturalHeight: ref(1050), pointer: () => null })
}))
vi.mock('@/config/env', () => ({ apiUrl: '' }))

const BattlemapScreen = (await import('@/components/BattlemapScreen.vue')).default

// What the server projects for a screen: no hidden tokens, no refs, each token
// with the counters it shows.
const projection = (overrides = {}) => ({
  battlemap_id: 'cave',
  name: 'Cave',
  image_url: '/api/asset-library/assets/asset-library/cave.png',
  grid: { type: 'square', size: 70, distance: 5, unit: 'ft' },
  tokens: [
    { id: 'orc', name: 'Orc', x: 2, y: 3, size: 1, image_url: null, color: null, meters: [{ name: 'HP', current: 2, max: 6, min: 0 }] },
    { id: 'aria', name: 'Aria', x: 1, y: 1, size: 1, image_url: null, color: '#34d399', meters: [] }
  ],
  ...overrides
})

describe('BattlemapScreen', () => {
  it('draws exactly the tokens it is given, with their counters', () => {
    const wrapper = mount(BattlemapScreen, { props: { state: projection() } })
    const tokens = wrapper.findAll('.token')
    expect(tokens.map((t) => t.find('.token-label').text())).toEqual(['Orc', 'Aria'])
    expect(tokens[0].find('.meter').exists()).toBe(true)
    expect(tokens[1].find('.meter').exists()).toBe(false)
  })

  it('fills in what a projection leaves out of the grid, and keeps what it says', () => {
    const wrapper = mount(BattlemapScreen, { props: { state: projection() } })
    expect(wrapper.find('pattern').attributes('width')).toBe('70')
    expect(wrapper.find('.grid-rect').attributes('opacity')).toBe('0.25') // the usual
  })

  it('has nothing to change, and does not take a drag for a move', async () => {
    const wrapper = mount(BattlemapScreen, { props: { state: projection() } })
    wrapper.find('.token').element.dispatchEvent(new PointerEvent('pointerdown', { clientX: 1, clientY: 1, bubbles: true }))
    wrapper.find('svg').element.dispatchEvent(new PointerEvent('pointermove', { clientX: 300, clientY: 300, bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.token').classes()).not.toContain('dragging')
  })

  it('follows the next projection', async () => {
    const wrapper = mount(BattlemapScreen, { props: { state: projection() } })
    await wrapper.setProps({ state: projection({ tokens: [projection().tokens[1]] }) })
    expect(wrapper.findAll('.token')).toHaveLength(1)
  })
})
