// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'

const m = vi.hoisted(() => ({ graph: null, fetch: null, open: vi.fn() }))
vi.mock('@/composables/useGraphData', () => ({
  useGraphData: () => ({ version: m.version }),
  fetchGraph: (...a) => m.fetch(...a)
}))
vi.mock('@/composables/useGraphModal', () => ({ useGraphModal: () => ({ open: m.open }) }))
vi.mock('@/composables/useConstellationGraph', async (orig) => ({
  ...(await orig()),
  drawStarfield: vi.fn()
}))

import RightSidebar from '@/components/RightSidebar.vue'

const graph = {
  nodes: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }, { id: 'far', title: 'Far' }],
  links: [{ source: 'a', target: 'b' }]
}
const router = { replace: vi.fn(() => Promise.resolve()), push: vi.fn() }
const make = (props = {}) => mount(RightSidebar, {
  props: { note: { id: 'a' }, headings: [], ...props },
  global: { mocks: { $router: router } }
})

beforeEach(() => {
  m.version = ref(0)
  m.fetch = vi.fn(() => Promise.resolve(graph))
  m.open.mockClear()
  router.replace.mockClear()
  router.push.mockClear()
})
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = '' })

describe('RightSidebar', () => {
  it('draws only the nodes connected to the current note', async () => {
    const w = make()
    await flushPromises()
    expect(w.vm.nodes.map((n) => n.id).sort()).toEqual(['a', 'b'])
    expect(w.vm.links).toHaveLength(1)
    expect(w.findAll('svg g g g')).toHaveLength(2)
    w.unmount()
  })

  it('makes the current note a bigger star', async () => {
    const w = make()
    await flushPromises()
    const [a, b] = ['a', 'b'].map((id) => w.vm.nodes.find((n) => n.id === id))
    expect(a.radius).toBeGreaterThan(b.radius)
    w.unmount()
  })

  it('says so when the graph cannot be loaded', async () => {
    m.fetch = vi.fn(() => Promise.reject(new Error('down')))
    const w = make()
    await flushPromises()
    expect(w.find('.graph-error').text()).toContain('Could not load constellation')
    w.unmount()
  })

  it('ignores a graph that arrives after another note was asked for', async () => {
    let release
    m.fetch = vi.fn(() => new Promise((r) => { release = r }))
    const w = make()
    await w.setProps({ note: { id: 'b' } })
    release(graph)
    await flushPromises()
    expect(w.vm.nodes.map((n) => n.id).sort()).toEqual(['a', 'b'])
    expect(m.fetch).toHaveBeenCalledTimes(2)
    w.unmount()
  })

  it('loads the graph again when a note was saved', async () => {
    const w = make()
    await flushPromises()
    m.version.value++
    await flushPromises()
    expect(m.fetch).toHaveBeenCalledTimes(2)
    w.unmount()
  })

  it('opens the full constellation', async () => {
    const w = make()
    await w.find('.full-graph-link').trigger('click')
    expect(m.open).toHaveBeenCalled()
    w.unmount()
  })

  it('goes to another note when its star is clicked, not to the current one', async () => {
    const w = make()
    await flushPromises()
    const stars = w.findAll('svg g g g')
    const ids = w.vm.nodes.map((n) => n.id)
    await stars[ids.indexOf('a')].trigger('click')
    expect(router.push).not.toHaveBeenCalled()
    await stars[ids.indexOf('b')].trigger('click')
    expect(router.push).toHaveBeenCalledTimes(1)
    w.unmount()
  })

  it('lists the headings and scrolls to one', async () => {
    const target = document.createElement('h2')
    target.id = 'lore'
    target.scrollIntoView = vi.fn()
    document.body.append(target)
    const w = make({ headings: [{ id: 'lore', text: 'Lore', level: 2 }, { id: 'gone', text: 'Gone', level: 3 }] })
    expect(w.findAll('.toc-nav li').map((li) => li.text())).toEqual(['Lore', 'Gone'])
    await w.findAll('.toc-nav a')[0].trigger('click')
    expect(target.scrollIntoView).toHaveBeenCalled()
    expect(router.replace).toHaveBeenCalledWith({ hash: '#lore' })
    expect(w.find('li.active').text()).toBe('Lore')
    await w.findAll('.toc-nav a')[1].trigger('click')
    expect(router.replace).toHaveBeenCalledTimes(1)
    w.unmount()
  })

  it('says when a note has no headings', () => {
    const w = make()
    expect(w.find('.no-headers').exists()).toBe(true)
    w.unmount()
  })

  it('highlights the heading nearest the top of the page', async () => {
    vi.useFakeTimers()
    let callback
    const observed = []
    vi.stubGlobal('IntersectionObserver', class {
      constructor(cb) { callback = cb }
      observe(el) { observed.push(el.id) }
      disconnect() {}
    })
    for (const id of ['one', 'two']) {
      const h = document.createElement('h2')
      h.id = id
      document.body.append(h)
    }
    const w = make({ headings: [{ id: 'one', text: 'One', level: 2 }, { id: 'two', text: 'Two', level: 2 }] })
    vi.advanceTimersByTime(200)
    expect(observed).toEqual(['one', 'two'])
    callback([
      { isIntersecting: true, target: { id: 'two' }, boundingClientRect: { top: 80 } },
      { isIntersecting: true, target: { id: 'one' }, boundingClientRect: { top: 10 } },
      { isIntersecting: false, target: { id: 'x' }, boundingClientRect: { top: 0 } }
    ])
    await w.vm.$nextTick()
    expect(w.vm.activeId).toBe('one')
    callback([])
    expect(w.vm.activeId).toBe('one')
    w.unmount()
    vi.unstubAllGlobals()
  })
})
