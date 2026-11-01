// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'

// jsdom has no SVG geometry: the map is as big as its image, and a pointer
// reads straight off the event (as in BattlemapCanvas.test.js).
const imageStatus = ref('ready')
vi.mock('@/composables/useMapViewport', () => ({
  useMapViewport: () => ({
    naturalWidth: ref(imageStatus.value === 'ready' ? 1000 : 0),
    naturalHeight: ref(imageStatus.value === 'ready' ? 500 : 0),
    imageStatus,
    pointer: (event) => ({ x: event.clientX, y: event.clientY })
  })
}))
vi.mock('@/config/env', () => ({ apiUrl: '' }))
vi.mock('@/components/ObservatoryModal.vue', () => ({ default: { render: () => null } }))

const ChartCanvas = (await import('@/components/ChartCanvas.vue')).default

const pointer = (type, x, y, init = {}) =>
  new PointerEvent(type, { clientX: x, clientY: y, button: 0, buttons: 1, pointerId: 1, bubbles: true, ...init })
const frame = () => new Promise((resolve) => requestAnimationFrame(resolve))

let wrapper = null
afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  imageStatus.value = 'ready'
})

function mountChart() {
  const chart = {
    id: 'realm', image_url: '/api/observatory/images/1a2b3c4d-map.png',
    pins: [{ id: 'p1', x: 10, y: 10, name: 'Keep', note_path: null }],
    paths: [{ id: 'road', points: [{ x: 0, y: 0 }, { x: 50, y: 50 }], direction: 'forward' }],
    annotations: []
  }
  wrapper = mount(ChartCanvas, { attachTo: document.body, props: { chart, editable: true } })
  return { chart, wrapper }
}

describe('ChartCanvas', () => {
  it('draws each path once per change, the line and its hit area alike', () => {
    const { wrapper } = mountChart()
    const [line, hit] = wrapper.findAll('.chart-path-group path')
    expect(line.attributes('d')).toBeTruthy()
    expect(hit.attributes('d')).toBe(line.attributes('d'))
  })

  it('finishes a path with a button, not only with Enter (a tablet has no keyboard)', async () => {
    const { chart, wrapper } = mountChart()
    await wrapper.find('[aria-label="Draw path"]').trigger('click')
    const finish = () => wrapper.findAll('.path-hint button').find((b) => b.text().includes('Finish'))
    expect(finish().attributes('disabled')).toBeDefined()
    const svg = wrapper.find('svg')
    await svg.trigger('click', { clientX: 100, clientY: 100 })
    await svg.trigger('click', { clientX: 500, clientY: 250 })
    expect(finish().attributes('disabled')).toBeUndefined()
    await finish().trigger('click')
    expect(chart.paths).toHaveLength(2)
    expect(chart.paths[1].points).toEqual([{ x: 10, y: 20 }, { x: 50, y: 50 }])
    expect(wrapper.emitted('change')).toHaveLength(1)
    expect(wrapper.find('.path-hint').exists()).toBe(false)
  })

  it('cancels a path with a button', async () => {
    const { chart, wrapper } = mountChart()
    await wrapper.find('[aria-label="Draw path"]').trigger('click')
    await wrapper.find('svg').trigger('click', { clientX: 100, clientY: 100 })
    await wrapper.findAll('.path-hint button').find((b) => b.text() === 'Cancel').trigger('click')
    expect(chart.paths).toHaveLength(1)
    expect(wrapper.find('.path-hint').exists()).toBe(false)
    expect(wrapper.emitted('change')).toBeUndefined()
  })

  it('keeps dragging a pin that passes under a panel, and ignores a right click', async () => {
    const { chart, wrapper } = mountChart()
    const pin = wrapper.find('.chart-pin').element
    pin.dispatchEvent(pointer('pointerdown', 100, 50, { button: 2 }))
    window.dispatchEvent(pointer('pointermove', 600, 300))
    await frame()
    expect(chart.pins[0]).toMatchObject({ x: 10, y: 10 })

    pin.dispatchEvent(pointer('pointerdown', 100, 50))
    wrapper.find('svg').element.dispatchEvent(new PointerEvent('pointerleave', { pointerId: 1 }))
    window.dispatchEvent(pointer('pointermove', 600, 300))
    window.dispatchEvent(pointer('pointerup', 600, 300))
    expect(chart.pins[0]).toMatchObject({ x: 60, y: 60 })
    expect(wrapper.emitted('change')).toHaveLength(1)
  })

  it('says so when the map image cannot be loaded, and offers another', () => {
    imageStatus.value = 'error'
    const { wrapper } = mountChart()
    expect(wrapper.find('svg').exists()).toBe(false)
    expect(wrapper.find('[role="alert"]').text()).toContain('could not be loaded')
    expect(wrapper.find('[role="alert"] button').text()).toContain('Choose map image')
  })

  it('puts a pin back when the browser cancels the drag', async () => {
    const { chart, wrapper } = mountChart()
    wrapper.find('.chart-pin').element.dispatchEvent(pointer('pointerdown', 100, 50))
    window.dispatchEvent(pointer('pointermove', 600, 300))
    await frame()
    expect(chart.pins[0]).toMatchObject({ x: 60, y: 60 })
    window.dispatchEvent(pointer('pointercancel', 600, 300))
    expect(chart.pins[0]).toMatchObject({ x: 10, y: 10 })
    expect(wrapper.emitted('change')).toBeUndefined()
  })
})
