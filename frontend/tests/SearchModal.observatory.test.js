// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils'

const { search, openDoc, openObservatory, push, user } = vi.hoisted(() => ({
  search: vi.fn(), openDoc: vi.fn(), openObservatory: vi.fn(), push: vi.fn(), user: { value: { email: 'gm@example.com' } }
}))
vi.mock('@/api/observatory', () => ({ observatoryApi: { search } }))
vi.mock('@/config/env', () => ({ apiUrl: '' }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))
vi.mock('@/composables/useAuth', () => ({ useAuth: () => ({ user: ref(user.value) }) }))
vi.mock('@/composables/useDocModal', () => ({ useDocModal: (type) => ({ open: (id) => openDoc(type, id) }) }))
vi.mock('@/composables/useObservatoryModal', () => ({ useObservatoryModal: () => ({ open: openObservatory }) }))

const SearchModal = (await import('@/components/SearchModal.vue')).default

const notes = [{ id: 'Places/Cienaga', title: 'Ciénaga notes', tags: [] }, { id: 'Places/Waterdeep', title: 'Waterdeep', tags: [] }]
const FOUND = [
  { kind: 'chart', id: 'act 2/cienaga', name: 'La Ciénaga', folder: 'act 2', image_url: '/api/observatory/images/1a2b3c4d-map.png' },
  { kind: 'encounter', id: 'ambush', name: 'Emboscada', folder: '' },
  { kind: 'image', id: '9f9f9f9f-cienaga.png', name: 'cienaga.png', folder: 'Mapas', url: '/api/observatory/images/9f9f9f9f-cienaga.png' }
]

function mountModal() {
  return mount(SearchModal, {
    props: { isOpen: true, notes, availableTags: [] },
    global: { stubs: { RouterLink: RouterLinkStub } },
    attachTo: document.body
  })
}

async function typed(wrapper, text) {
  vi.useFakeTimers()
  await wrapper.find('input.search-input').setValue(text)
  await vi.advanceTimersByTimeAsync(300)
  vi.useRealTimers()
  await flushPromises()
}

beforeEach(() => {
  vi.clearAllMocks()
  search.mockResolvedValue({ items: FOUND })
})

describe('SearchModal — everything, not only notes', () => {
  it('finds documents and images in the Observatory as well as notes, each saying what and where it is', async () => {
    const wrapper = mountModal()
    await typed(wrapper, 'cien')
    expect(search).toHaveBeenCalledWith('cien')
    expect(wrapper.findAll('.results-group').map((g) => g.text())).toEqual(['Notes', 'Observatory'])
    expect(wrapper.findAll('.result-title').map((t) => t.text())).toEqual(['Ciénaga notes', 'La Ciénaga', 'Emboscada', 'cienaga.png'])
    expect(wrapper.findAll('.result-kind').map((k) => k.text())).toEqual(['Chart', 'Encounter', 'Image'])
    expect(wrapper.findAll('.result-path').map((p) => p.text())).toEqual(['Places/Cienaga', 'act 2', 'Observatory', 'Mapas'])
    expect(wrapper.findAll('.result-mark img').length).toBe(2) // the chart's map and the image
    wrapper.unmount()
  })

  it('opens what is chosen with the keyboard: a document in its editor, an image in its folder', async () => {
    const wrapper = mountModal()
    await typed(wrapper, 'cien')
    const input = wrapper.find('input.search-input')
    await input.trigger('keydown', { key: 'ArrowDown' })
    expect(wrapper.find('.result-item.is-active .result-title').text()).toBe('La Ciénaga')
    await input.trigger('keydown', { key: 'Enter' })
    expect(openDoc).toHaveBeenCalledWith('chart', 'act 2/cienaga')
    expect(wrapper.emitted('close')).toHaveLength(1)

    await input.trigger('keydown', { key: 'ArrowUp' })
    await input.trigger('keydown', { key: 'ArrowUp' }) // past the first, round to the last
    await input.trigger('keydown', { key: 'Enter' })
    expect(openObservatory).toHaveBeenCalledWith('Mapas')
    wrapper.unmount()
  })

  it('shows the first few of each group while searching, and the rest on asking', async () => {
    const many = Array.from({ length: 11 }, (_, i) => ({ id: `World/Wei/n${i}`, title: `Wei ${i}`, tags: [] }))
    const wrapper = mount(SearchModal, {
      props: { isOpen: true, notes: many, availableTags: [] },
      global: { stubs: { RouterLink: RouterLinkStub } },
      attachTo: document.body
    })
    await typed(wrapper, 'wei')
    expect(wrapper.findAll('.result-item').filter((r) => !r.find('.result-kind').exists())).toHaveLength(8)
    expect(wrapper.findAll('.result-kind')).toHaveLength(3) // the Observatory's are on screen too
    const more = wrapper.find('.results-more')
    expect(more.text()).toBe('Show 3 more notes')
    await more.trigger('click')
    expect(wrapper.findAll('.result-item')).toHaveLength(14)
    wrapper.unmount()
  })

  it('opens a note with Enter, and asks the Observatory nothing until something is typed', async () => {
    const wrapper = mountModal()
    expect(search).not.toHaveBeenCalled()
    await wrapper.find('input.search-input').trigger('keydown', { key: 'Enter' })
    expect(push).toHaveBeenCalledWith('/note/Places/Cienaga')
    wrapper.unmount()
  })
})
