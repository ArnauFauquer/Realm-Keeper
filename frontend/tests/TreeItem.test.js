// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import TreeItem from '@/components/TreeItem.vue'

const RouterLink = { props: ['to'], template: '<a :href="to" v-bind="$attrs"><slot /></a>' }
const make = (item, props = {}) => mount(TreeItem, { props: { item, ...props }, global: { stubs: { 'router-link': RouterLink } } })

const folder = (extra = {}) => ({
  isFolder: true, path: 'People', name: 'People', expanded: true,
  children: [{ isFolder: true, path: 'People/Elves', name: 'Elves', expanded: false, children: [], notes: [] }],
  notes: [{ id: 'People/Mirela', title: 'Mirela' }],
  ...extra
})

describe('TreeItem', () => {
  it('links a note to its route', async () => {
    const w = make({ id: 'Places/The Rusty Anchor', title: 'The Rusty Anchor' })
    const a = w.find('a')
    expect(a.attributes('href')).toBe('/note/Places/The%20Rusty%20Anchor')
    expect(a.text()).toBe('The Rusty Anchor')
    await a.trigger('click')
    expect(w.emitted('note-click')).toHaveLength(1)
  })

  it('shows an open folder with its subfolders and notes', () => {
    const w = make(folder())
    expect(w.find('.folder').attributes('aria-expanded')).toBe('true')
    expect(w.find('.mdi-folder-open').exists()).toBe(true)
    expect(w.findAll('.row-label').map((l) => l.text())).toEqual(['People', 'Elves', 'Mirela'])
  })

  it('hides the contents of a closed folder', () => {
    const w = make(folder({ expanded: false }))
    expect(w.find('.children').exists()).toBe(false)
    expect(w.find('.mdi-folder').exists()).toBe(true)
  })

  it('draws an empty folder with a dot instead of a chevron', () => {
    const w = make(folder({ children: [], notes: [] }))
    expect(w.find('.chevron').classes()).toContain('mdi-circle-small')
    expect(make(folder()).find('.chevron').classes()).toContain('mdi-chevron-right')
  })

  it('tells the tree which folder to toggle, including nested ones', async () => {
    const w = make(folder())
    await w.find('.folder').trigger('click')
    expect(w.emitted('toggle')[0]).toEqual(['People'])
    await w.findAll('.folder')[1].trigger('click')
    expect(w.emitted('toggle')[1]).toEqual(['People/Elves'])
  })

  it('indents deeper levels more, and bubbles note clicks up', async () => {
    const w = make(folder(), { level: 2 })
    expect(w.find('.folder').attributes('style')).toContain('calc(2 *')
    await w.find('.children a').trigger('click')
    expect(w.emitted('note-click')).toHaveLength(1)
  })
})
