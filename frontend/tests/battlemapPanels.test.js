// @vitest-environment jsdom
// The battlemap's smaller panels: framing a token's image, its range bands,
// one area.
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

vi.mock('@/config/env', () => ({ apiUrl: '' }))

const TokenImageEditor = (await import('@/components/TokenImageEditor.vue')).default
const RangeBandsEditor = (await import('@/components/RangeBandsEditor.vue')).default
const AreaInspector = (await import('@/components/AreaInspector.vue')).default

const IMAGE = '/api/observatory/images/1a2b3c4d-orc.png'
const pointer = (type, x, y) => new PointerEvent(type, { clientX: x, clientY: y, button: 0, pointerId: 1, bubbles: true })

describe('TokenImageEditor', () => {
  const mountFrame = (props = {}) => mount(TokenImageEditor, { props: { imageUrl: IMAGE, ...props } })

  it('shows the image as the token frames it', () => {
    const img = mountFrame({ scale: 2, x: 0.25 }).find('img')
    expect(img.attributes('style')).toContain('width: 200%')
    expect(img.attributes('style')).toContain('left: -25%') // 50 - 100 + 25
  })

  it('moves the image with a drag of the frame, in token widths, and says so once let go of', async () => {
    const wrapper = mountFrame()
    const frame = wrapper.find('.frame')
    Object.defineProperty(frame.element, 'clientWidth', { value: 100 })
    frame.element.dispatchEvent(pointer('pointerdown', 50, 50))
    frame.element.dispatchEvent(pointer('pointermove', 70, 40))
    expect(wrapper.emitted('change')).toBeUndefined()
    frame.element.dispatchEvent(pointer('pointerup', 70, 40))
    expect(wrapper.emitted('change')).toEqual([[{ image_x: 0.2, image_y: -0.1 }]])
  })

  it('zooms and turns with its sliders, and resets', async () => {
    const wrapper = mountFrame({ scale: 1.5, rotation: 30 })
    const [zoom, turn] = wrapper.findAll('input[type="range"]')
    zoom.element.value = '2'
    await zoom.trigger('input')
    await zoom.trigger('change')
    expect(wrapper.emitted('change')[0]).toEqual([{ image_scale: 2 }])
    turn.element.value = '-45'
    await turn.trigger('input')
    await turn.trigger('change')
    expect(wrapper.emitted('change')[1]).toEqual([{ image_scale: 2, rotation: -45 }]) // what differs from the token
    await wrapper.find('button').trigger('click')
    expect(wrapper.emitted('change')[2]).toEqual([{ image_scale: 1, rotation: 0 }])
  })

  it('only shows, when it may not change', () => {
    const wrapper = mountFrame({ disabled: true })
    wrapper.find('.frame').element.dispatchEvent(pointer('pointerdown', 50, 50))
    wrapper.find('.frame').element.dispatchEvent(pointer('pointerup', 90, 50))
    expect(wrapper.emitted('change')).toBeUndefined()
    expect(wrapper.find('input').attributes('disabled')).toBeDefined()
  })
})

describe('RangeBandsEditor', () => {
  const BANDS = [{ name: 'Near', max: 3 }, { name: 'Far', max: null }]

  it('starts from an example, as a place to begin', async () => {
    const wrapper = mount(RangeBandsEditor, { props: { bands: [] } })
    await wrapper.findAll('button').find((b) => b.text().includes('example')).trigger('click')
    const [bands] = wrapper.emitted('change')[0]
    expect(bands.at(-1).max).toBeNull()
    expect(bands.map((b) => b.max).slice(0, -1)).toEqual([...bands.map((b) => b.max).slice(0, -1)].sort((a, b) => a - b))
  })

  it('renames and resizes a band, and adds one before an unlimited last one', async () => {
    const wrapper = mount(RangeBandsEditor, { props: { bands: BANDS } })
    const name = wrapper.find('.band-name')
    name.element.value = 'Close'
    await name.trigger('change')
    expect(wrapper.emitted('change')[0][0][0]).toEqual({ name: 'Close', max: 3 })
    await wrapper.findAll('button').find((b) => b.text().includes('Add a range')).trigger('click')
    expect(wrapper.emitted('change')[1][0].map((b) => [b.name, b.max])).toEqual([['Close', 3], ['Range 3', 6], ['Far', null]])
  })

  it('says what is wrong with a list out of order, and sends only good ones', async () => {
    const wrapper = mount(RangeBandsEditor, { props: { bands: BANDS } })
    const reach = wrapper.find('.band-max input')
    reach.element.value = ''
    await reach.trigger('change') // the first would reach without limit
    expect(wrapper.find('.problem').text()).toContain('Only the last')
    expect(wrapper.emitted('change')).toBeUndefined()
  })
})

describe('AreaInspector', () => {
  const AREA = { id: 'a1', shape: 'cone', x: 1, y: 1, size: 4, angle: 45, spread: 60, width: 1, color: null, label: 'Breath', hidden: false }
  const GRID = { size: 70, distance: 5, unit: 'ft', measure: 'grid' }
  const mountInspector = (area = AREA) => mount(AreaInspector, { props: { area, grid: GRID } })

  it('shows what a cone needs, and its reach', () => {
    const wrapper = mountInspector()
    expect(wrapper.find('.measure').text()).toBe('20 ft')
    const labels = wrapper.findAll('.field span').map((s) => s.text())
    expect(labels).toEqual(['Length (cells)', 'Direction (°)', 'Opening (°)'])
    expect(mountInspector({ ...AREA, shape: 'circle' }).findAll('.field span').map((s) => s.text())).toEqual(['Radius (cells)'])
  })

  it('asks for its changes, within bounds', async () => {
    const wrapper = mountInspector()
    await wrapper.find('button[aria-label="Square"]').trigger('click')
    expect(wrapper.emitted('patch')[0]).toEqual([{ shape: 'square' }])
    const [size, , spread] = wrapper.findAll('input[type="number"]')
    size.element.value = '6'
    await size.trigger('change')
    expect(wrapper.emitted('patch')[1]).toEqual([{ size: 6 }])
    spread.element.value = '999'
    await spread.trigger('change')
    expect(wrapper.emitted('patch')[2]).toEqual([{ spread: 360 }])
    await wrapper.find('.swatch').trigger('click')
    expect(wrapper.emitted('patch')[3]).toEqual([{ color: '#f97316' }])
    await wrapper.find('input[type="checkbox"]').setValue(true)
    expect(wrapper.emitted('patch')[4]).toEqual([{ hidden: true }])
    await wrapper.find('.danger').trigger('click')
    expect(wrapper.emitted('remove')).toHaveLength(1)
  })
})
