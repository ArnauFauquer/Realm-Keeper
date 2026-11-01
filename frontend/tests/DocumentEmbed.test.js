// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { flushPromises, mount as vtuMount } from '@vue/test-utils'

const m = vi.hoisted(() => ({
  push: vi.fn(), fetchChart: vi.fn(), fetchVista: vi.fn(), openModal: vi.fn(),
  chart: vi.fn(), vista: vi.fn()
}))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: m.push }) }))
vi.mock('@/api/docs', () => ({
  docApi: (type) => ({ fetch: type === 'chart' ? m.fetchChart : m.fetchVista })
}))
vi.mock('@/api/screen', () => ({ screenApi: { chart: m.chart, vista: m.vista } }))
vi.mock('@/composables/useDocModal', () => ({ useDocModal: () => ({ open: m.openModal }) }))
vi.mock('@/composables/useImageSize', async () => {
  const { ref } = await import('vue')
  return { useImageSize: () => ({ status: ref('ready'), width: ref(400), height: ref(200) }) }
})
const canvas = (name) => ({
  default: defineComponent({ name, props: ['chart', 'vista', 'editable', 'zoomable'], emits: ['open-note'], render() { return h('div', { class: `canvas-${name}` }) } })
})
vi.mock('@/components/ChartCanvas.vue', () => canvas('ChartCanvas'))
vi.mock('@/components/VistaCanvas.vue', () => canvas('VistaCanvas'))

const DocumentEmbed = (await import('@/components/DocumentEmbed.vue')).default

const mounted = []
const mount = (props) => {
  const w = vtuMount(DocumentEmbed, { props: { type: 'chart', id: 'regions/tavern', canInteract: true, ...props } })
  mounted.push(w)
  return w
}
const CHART = { id: 'regions/tavern', name: 'Tavern', image_url: '/api/observatory/images/a.png' }

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset?.()
  m.fetchChart.mockResolvedValue({ ...CHART })
  m.fetchVista.mockResolvedValue({ id: 'night', name: 'Night', background_url: '/bg.png' })
  m.chart.mockResolvedValue()
  m.vista.mockResolvedValue()
})
afterEach(() => { mounted.splice(0).forEach((w) => w.unmount()) })

describe('DocumentEmbed', () => {
  it('shows a placeholder instead of fetching for someone who is not signed in', async () => {
    const w = mount({ canInteract: false })
    await flushPromises()
    expect(w.text()).toContain('Sign in to view this chart')
    expect(m.fetchChart).not.toHaveBeenCalled()
  })

  it('shows a skeleton while the document loads, then its canvas and name', async () => {
    let arrive
    m.fetchChart.mockReturnValue(new Promise((resolve) => { arrive = resolve }))
    const w = mount()
    expect(w.find('.embed-loading').text()).toContain('Loading chart')
    arrive({ ...CHART })
    await flushPromises()
    expect(m.fetchChart).toHaveBeenCalledWith('regions/tavern')
    expect(w.find('.embed-name').text()).toBe('Tavern')
    expect(w.findComponent({ name: 'ChartCanvas' }).props()).toMatchObject({ chart: { name: 'Tavern' }, editable: false, zoomable: false })
  })

  it('frames a chart to its map image and a vista to a 16:9 stage', async () => {
    const chart = mount()
    await flushPromises()
    expect(chart.find('.embed-frame').attributes('style')).toContain('400 / 200')
    const vista = mount({ type: 'vista', id: 'night' })
    await flushPromises()
    expect(vista.find('.embed-frame').attributes('style')).toContain('16 / 9')
    expect(vista.findComponent({ name: 'VistaCanvas' }).props('vista')).toMatchObject({ name: 'Night' })
  })

  it('says "not found" for a missing document, and gives the server reason otherwise', async () => {
    m.fetchChart.mockRejectedValueOnce({ response: { status: 404 } })
    const missing = mount()
    await flushPromises()
    expect(missing.find('[role=alert]').text()).toContain('chart:regions/tavern: not found')
    m.fetchChart.mockRejectedValueOnce({ response: { status: 500, data: { detail: 'Boom' } } })
    const broken = mount()
    await flushPromises()
    expect(broken.find('[role=alert]').text()).toContain('Boom')
  })

  it('falls back to the sign-in placeholder when the session has expired', async () => {
    m.fetchChart.mockRejectedValue({ response: { status: 401 } })
    const w = mount()
    await flushPromises()
    expect(w.text()).toContain('Sign in to view this chart')
  })

  it('opens the document in its modal when clicked, but only for someone signed in', async () => {
    const w = mount()
    await flushPromises()
    expect(w.find('.embed-frame').attributes('title')).toBe('Open Tavern')
    await w.find('.embed-frame').trigger('click')
    expect(m.openModal).toHaveBeenCalledWith('regions/tavern')
  })

  it('goes to the note of a pin', async () => {
    const w = mount()
    await flushPromises()
    await w.findComponent({ name: 'ChartCanvas' }).vm.$emit('open-note', 'People/Mirela')
    expect(m.push).toHaveBeenCalledWith('/note/People/Mirela')
  })

  it('sends the chart to the screen and says so for a moment', async () => {
    const w = mount()
    await flushPromises()
    await w.find('.embed-btn').trigger('click')
    await flushPromises()
    expect(m.chart).toHaveBeenCalledWith('regions/tavern')
    expect(m.openModal).not.toHaveBeenCalled()
    expect(w.find('.embed-btn').text()).toBe('Sent!')
  })

  it('sends a vista through the vista route', async () => {
    const w = mount({ type: 'vista', id: 'night' })
    await flushPromises()
    await w.find('.embed-btn').trigger('click')
    expect(m.vista).toHaveBeenCalledWith('night')
  })

  it('logs and carries on when the screen refuses', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    m.chart.mockRejectedValue(new Error('no screen'))
    const w = mount()
    await flushPromises()
    await w.find('.embed-btn').trigger('click')
    await flushPromises()
    expect(log).toHaveBeenCalled()
    expect(w.find('.embed-btn').text()).toBe('Screen')
    log.mockRestore()
  })

  it('has no screen button for a document without a picture', async () => {
    m.fetchChart.mockResolvedValue({ id: 'x', name: 'Bare' })
    const w = mount()
    await flushPromises()
    expect(w.find('.embed-btn').exists()).toBe(false)
  })

  it('loads again when it is pointed at another document', async () => {
    const w = mount()
    await flushPromises()
    m.fetchChart.mockResolvedValue({ ...CHART, id: 'other', name: 'Other' })
    await w.setProps({ id: 'other' })
    await flushPromises()
    expect(m.fetchChart).toHaveBeenLastCalledWith('other')
    expect(w.find('.embed-name').text()).toBe('Other')
  })
})
