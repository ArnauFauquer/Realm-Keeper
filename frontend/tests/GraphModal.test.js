// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'

const m = vi.hoisted(() => ({}))
vi.mock('@/composables/useGraphData', () => ({
  useGraphData: () => ({ version: m.version }),
  fetchGraph: (...a) => m.fetch(...a)
}))
vi.mock('@/composables/useAuth', () => ({ useAuth: () => ({ user: m.user }) }))
vi.mock('@/composables/useLiveScreen', () => ({ useLiveScreen: (...a) => m.live(...a) }))
vi.mock('@/composables/useConstellationGraph', async (orig) => ({ ...(await orig()), drawStarfield: vi.fn() }))
vi.mock('@/composables/constellationCanvas', () => ({
  decorateNodes: vi.fn(),
  createConstellationCanvas: (opts) => { m.opts = opts; return m.renderer }
}))

import GraphModal from '@/components/GraphModal.vue'

const graph = () => ({
  nodes: [{ id: 'a', type: 'npc' }, { id: 'b', type: 'npc' }, { id: 'c', type: 'place' }],
  links: [{ source: 'a', target: 'b' }]
})
const router = { push: vi.fn() }
const make = (isOpen = true) => mount(GraphModal, {
  props: { isOpen },
  global: { mocks: { $router: router } }
})

beforeEach(() => {
  m.version = ref(0)
  m.user = ref({ name: 'GM' })
  m.fetch = vi.fn(() => Promise.resolve(graph()))
  m.renderer = { setHighlightedType: vi.fn(), getSnapshot: vi.fn(() => ({ zoom: 1 })), destroy: vi.fn() }
  m.stop = vi.fn()
  m.sendToScreen = vi.fn()
  m.toggle = vi.fn()
  m.live = vi.fn(() => ({ live: ref(false), sending: ref(false), sendToScreen: m.sendToScreen, toggle: m.toggle, stop: m.stop }))
  router.push.mockClear()
})

describe('GraphModal', () => {
  it('draws nothing while closed, and fetches nothing', () => {
    const w = make(false)
    expect(w.find('.rk-scrim').exists()).toBe(false)
    expect(m.fetch).not.toHaveBeenCalled()
  })

  it('loads the graph when it opens and draws it on the canvas', async () => {
    const w = make(true)
    expect(w.find('.graph-state').text()).toBeDefined()
    await flushPromises()
    expect(m.opts.nodes).toHaveLength(3)
    expect(w.find('canvas.graph-canvas').exists()).toBe(true)
    w.unmount()
  })

  it('counts the notes of each type, the biggest first', async () => {
    const w = make()
    await flushPromises()
    expect(Object.entries(w.vm.typeStatistics)).toEqual([['npc', 2], ['place', 1]])
    w.unmount()
  })

  it('highlights a type and takes the highlight off when it is chosen again', async () => {
    const w = make()
    await flushPromises()
    w.vm.toggleTypeHighlight('npc')
    expect(m.renderer.setHighlightedType).toHaveBeenLastCalledWith('npc')
    w.vm.toggleTypeHighlight('npc')
    expect(m.renderer.setHighlightedType).toHaveBeenLastCalledWith(null)
    w.unmount()
  })

  it('shows why it could not load', async () => {
    m.fetch = vi.fn(() => Promise.reject(new Error('down')))
    const w = make()
    await flushPromises()
    expect(w.vm.error).toBeTruthy()
    expect(w.find('.graph-container').exists()).toBe(false)
    w.unmount()
  })

  it('says so when there are no notes', async () => {
    m.fetch = vi.fn(() => Promise.resolve({ nodes: [], links: [] }))
    const w = make()
    await flushPromises()
    expect(w.find('.rk-empty').exists()).toBe(true)
    w.unmount()
  })

  it('opens the note of a clicked star and closes', async () => {
    const w = make()
    await flushPromises()
    m.opts.onNodeClick({ id: 'a' })
    expect(router.push).toHaveBeenCalledTimes(1)
    expect(w.emitted('close')).toHaveLength(1)
    w.unmount()
  })

  it('closes from the button and from the backdrop', async () => {
    const w = make()
    await w.find('[aria-label="Close constellation"]').trigger('click')
    await w.find('.rk-scrim').trigger('click')
    expect(w.emitted('close')).toHaveLength(2)
    w.unmount()
  })

  it('tears the graph down when it closes, and ends the mirroring', async () => {
    const w = make()
    await flushPromises()
    await w.setProps({ isOpen: false })
    expect(m.renderer.destroy).toHaveBeenCalled()
    expect(m.stop).toHaveBeenCalled()
    w.unmount()
  })

  it('reopens on the same graph, but fetches again after a note was saved', async () => {
    const w = make()
    await flushPromises()
    await w.setProps({ isOpen: false })
    await w.setProps({ isOpen: true })
    await flushPromises()
    expect(m.fetch).toHaveBeenCalledTimes(1)
    await w.setProps({ isOpen: false })
    m.version.value++
    await w.setProps({ isOpen: true })
    await flushPromises()
    expect(m.fetch).toHaveBeenCalledTimes(2)
    w.unmount()
  })

  it('changes the forces of a running layout', async () => {
    const w = make()
    await flushPromises()
    const sim = w.vm.graph.simulation
    w.vm.forceSettings.linkDistance = 90
    w.vm.updateChargeStrength('300')
    expect(sim.force('charge').strength()()).toBe(-300)
    expect(sim.force('link').distance()()).toBe(90)
    w.unmount()
  })

  it('does nothing about forces when no graph is drawn', async () => {
    const w = make(false)
    expect(() => w.vm.updateForces()).not.toThrow()
  })

  it('offers the screen only to a signed-in user', async () => {
    const w = make()
    await flushPromises()
    expect(w.text()).toContain('Go live')
    await w.findAll('.header-btn')[1].trigger('click')
    expect(m.sendToScreen).toHaveBeenCalled()
    await w.findAll('.header-btn')[0].trigger('click')
    expect(m.toggle).toHaveBeenCalled()
    w.unmount()
    m.user.value = null
    const anon = make()
    await flushPromises()
    expect(anon.text()).not.toContain('Go live')
    anon.unmount()
  })

  it('tells the live screen when the view changes, only while mirroring', async () => {
    const live = ref(true)
    m.live = vi.fn(() => ({ live, sending: ref(false), sendToScreen: m.sendToScreen, toggle: m.toggle, stop: m.stop }))
    const w = make()
    await flushPromises()
    m.opts.onChange()
    expect(w.vm.liveBridge.changes).toBe(1)
    live.value = false
    m.opts.onChange()
    expect(w.vm.liveBridge.changes).toBe(1)
    w.unmount()
  })
})
