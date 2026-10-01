// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { mount, RouterLinkStub } from '@vue/test-utils'
import SearchModal from '../src/components/SearchModal.vue'

const notes = [
  { id: 'Characters/Hero', title: 'Hero', tags: ['pc'] },
  { id: 'Places/Waterdeep', title: 'Waterdeep', tags: ['city'] },
  { id: 'Places/Neverwinter', title: 'Neverwinter', tags: ['city', 'north'] }
]

function mountModal(props = {}) {
  return mount(SearchModal, {
    props: { isOpen: true, notes, availableTags: ['pc', 'city', 'north'], ...props },
    global: { stubs: { RouterLink: RouterLinkStub } },
    attachTo: document.body
  })
}

const resultTitles = (wrapper) => wrapper.findAll('.result-title').map(el => el.text())

describe('SearchModal.vue', () => {
  it('renders nothing while closed', () => {
    const wrapper = mountModal({ isOpen: false })
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
  })

  it('lists every note before anything is typed', () => {
    const wrapper = mountModal()
    expect(resultTitles(wrapper)).toEqual(['Hero', 'Waterdeep', 'Neverwinter'])
  })

  it('filters by title or path', async () => {
    const wrapper = mountModal()
    await wrapper.find('input.search-input').setValue('places/')
    expect(resultTitles(wrapper)).toEqual(['Waterdeep', 'Neverwinter'])

    await wrapper.find('input.search-input').setValue('never')
    expect(resultTitles(wrapper)).toEqual(['Neverwinter'])
  })

  it('filters by a tag added from outside', async () => {
    const wrapper = mountModal()
    wrapper.vm.addExternalTag('north')
    await wrapper.vm.$nextTick()
    expect(resultTitles(wrapper)).toEqual(['Neverwinter'])
    expect(wrapper.find('.selected-tag').text()).toContain('north')
  })

  it('shows the empty state when nothing matches', async () => {
    const wrapper = mountModal()
    await wrapper.find('input.search-input').setValue('dragon')
    expect(wrapper.find('.no-results').exists()).toBe(true)
  })

  it('closes on Escape and on the close button', async () => {
    const wrapper = mountModal({ isOpen: false })
    await wrapper.setProps({ isOpen: true })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(wrapper.emitted('close')).toHaveLength(1)

    await wrapper.find('button[aria-label="Close search"]').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(2)
    wrapper.unmount()
  })
})
