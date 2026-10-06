// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { h, ref } from 'vue'
import { mount } from '@vue/test-utils'

const { sanitize } = vi.hoisted(() => ({ sanitize: vi.fn((html) => html) }))
vi.mock('@/utils/sanitizeHtml', () => ({ sanitizeHtml: sanitize }))
vi.mock('@/composables/useDiceRoller', () => ({ useDiceRoller: () => ({ roll: vi.fn() }) }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/config/env', () => ({ apiUrl: '' }))

const SheetView = (await import('@/components/SheetView.vue')).default

const SHEET = {
  id: 'orc', name: 'Orc', type: 'adversary', subtitle: null, image: null, tags: [], stats: [], columns: null,
  text: 'An **orc**.',
  resources: { HP: { max: 6, min: 0, start: null, color: null, style: null } },
  sections: [{
    title: null, columns: null, wide: false, collapsed: false, tab: null, counters: ['HP'], stats: [],
    items: [{ name: 'Axe', text: 'Hits *hard*.', roll: null, tags: [], cost: null }]
  }]
}

describe('SheetView', () => {
  it('renders its texts once, not again each time a live counter changes', async () => {
    const hp = ref(6)
    const wrapper = mount(SheetView, {
      props: { sheet: SHEET },
      slots: { counter: () => h('span', { class: 'live' }, String(hp.value)) }
    })
    expect(wrapper.html()).toContain('<em>hard</em>')
    const renders = sanitize.mock.calls.length
    hp.value = 5
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.live').text()).toBe('5')
    expect(sanitize.mock.calls.length).toBe(renders)
  })
})
