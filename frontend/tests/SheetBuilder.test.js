// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { sheetFromDoc } from '@/utils/sheet'

vi.mock('@/composables/useDiceRoller', () => ({ useDiceRoller: () => ({ roll: vi.fn() }) }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/config/env', () => ({ apiUrl: '' }))

const SheetEditor = (await import('@/components/SheetEditor.vue')).default

const BUGBOAR = {
  sections: [
    { counters: [{ name: 'HP', max: 6 }, { name: 'Stress', max: 3, start: 0 }] },
    { title: 'Actions', items: [{ name: 'Gore', roll: '1d20+3' }] }
  ]
}

// The editor as the adversaries' modal uses it: v-model on the sheet, switched
// to Edit (a sheet with something on it opens in preview).
function mountEditor(sheet = BUGBOAR, props = {}) {
  const wrapper = mountSheet(sheet, props)
  if (!wrapper.find('.sheet-builder').exists()) button(wrapper, 'Edit')?.trigger('click')
  return wrapper
}

function mountSheet(sheet = BUGBOAR, props = {}) {
  const wrapper = mount(SheetEditor, {
    props: {
      type: 'adversary',
      id: 'beasts/bugboar',
      name: 'Bugboar',
      canEdit: true,
      modelValue: sheet,
      'onUpdate:modelValue': (value) => wrapper.setProps({ modelValue: value }),
      ...props
    },
    attachTo: document.body
  })
  return wrapper
}
const saved = (wrapper) => wrapper.props('modelValue')
const sheetOf = (wrapper) => sheetFromDoc({ id: 'bugboar', name: 'Bugboar', sheet: saved(wrapper) }, 'adversary').sheet
const button = (wrapper, text) => wrapper.findAll('button').find((b) => b.text().includes(text))

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('SheetBuilder', () => {
  it('shows the sheet as forms, and sends nothing until something changes', async () => {
    const wrapper = mountEditor()
    await flushPromises()
    expect(wrapper.find('textarea.source-input').exists()).toBe(false)
    const names = wrapper.findAll('input[aria-label="Counter name"]').map((i) => i.element.value)
    expect(names).toEqual(['HP', 'Stress'])
    expect(wrapper.find('input[aria-label="Entry name"]').element.value).toBe('Gore')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('edits a counter, and the sheet and the preview follow', async () => {
    const wrapper = mountEditor()
    await flushPromises()
    await wrapper.findAll('input[aria-label="Maximum"]')[0].setValue('8')
    expect(saved(wrapper).sections[0].counters[0]).toEqual({ name: 'HP', max: 8, min: 0, start: null, color: null, style: null })
    expect(wrapper.find('.sheet-editor-preview .rc-value').text()).toBe('8')
  })

  it('builds a section from nothing: a counter, a stat and an entry', async () => {
    const wrapper = mountEditor({})
    await flushPromises()
    await button(wrapper, 'Add section').trigger('click')
    await wrapper.find('.b-section-title').setValue('Combat')
    await button(wrapper, 'Counter').trigger('click')
    await wrapper.find('input[aria-label="Counter name"]').setValue('Wounds')
    await wrapper.find('input[aria-label="Starts at"]').setValue('0')
    await button(wrapper, 'Stats').trigger('click')
    await wrapper.find('input[aria-label="Stat label"]').setValue('Armor')
    await wrapper.find('input[aria-label="Stat value"]').setValue('3')
    await button(wrapper, 'Entry').trigger('click')
    await flushPromises()
    expect(document.activeElement).toBe(wrapper.find('input[aria-label="Entry name"]').element)  // what was added is focused
    await wrapper.find('input[aria-label="Entry name"]').setValue('Bite')
    await wrapper.find('input[aria-label="Entry roll"]').setValue('1d6')

    const sheet = sheetOf(wrapper)
    expect(sheet.resources).toEqual({ Wounds: { max: 6, min: 0, start: 0, color: null, style: null } })
    expect(sheet.sections[0]).toMatchObject({
      title: 'Combat',
      counters: ['Wounds'],
      stats: [{ title: null, columns: null, stats: [{ label: 'Armor', value: 3, roll: null }] }],
      items: [{ name: 'Bite', roll: '1d6', text: null, tags: [], cost: null }]
    })
  })

  it('offers a template while the sheet is empty, from the system picked', async () => {
    const wrapper = mountEditor({})
    await flushPromises()
    await button(wrapper, 'Start from a template').trigger('click')
    const systems = wrapper.findAll('[role="menuitem"]').map((b) => b.find('.template-menu-name').text())
    expect(systems).toEqual(['Generic', 'D&D 5e', 'Daggerheart', 'Pathfinder 2e', 'Call of Cthulhu 7e', 'Cyberpunk RED', 'Shadowdark', 'Blades in the Dark'])
    await button(wrapper, 'Daggerheart').trigger('click')
    expect(wrapper.findAll('input[aria-label="Counter name"]').map((i) => i.element.value)).toEqual(['HP', 'Stress'])
    expect(wrapper.text()).toContain('Motives & tactics')
    expect(button(wrapper, 'Start from a template')).toBeUndefined()
  })

  it('starts from the generic template', async () => {
    const wrapper = mountEditor({})
    await flushPromises()
    await button(wrapper, 'Start from a template').trigger('click')
    await button(wrapper, 'Generic').trigger('click')
    expect(wrapper.findAll('input[aria-label="Counter name"]').map((i) => i.element.value)).toEqual(['HP', 'Stress'])
    expect(wrapper.find('[role="menu"]').exists()).toBe(false)
  })

  it('closes the template menu on Escape', async () => {
    const wrapper = mountEditor({})
    await flushPromises()
    await button(wrapper, 'Start from a template').trigger('click')
    await wrapper.find('[role="menu"]').trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('[role="menu"]').exists()).toBe(false)
  })

  it('deletes one row, not two', async () => {
    const wrapper = mountEditor()
    await flushPromises()
    await wrapper.find('button[aria-label="Delete counter"]').trigger('click')
    expect(Object.keys(sheetOf(wrapper).resources)).toEqual(['Stress'])
  })

  it('moves a row with the arrow keys on its handle', async () => {
    const wrapper = mountEditor()
    await flushPromises()
    await wrapper.find('button[aria-label^="Move counter"]').trigger('keydown', { key: 'ArrowDown' })
    expect(Object.keys(sheetOf(wrapper).resources)).toEqual(['Stress', 'HP'])
  })

  it('says what is wrong: two counters with the same name', async () => {
    const wrapper = mountEditor()
    await flushPromises()
    await wrapper.findAll('input[aria-label="Counter name"]')[1].setValue('HP')
    expect(wrapper.findAll('input[aria-label="Counter name"]').every((i) => i.classes('is-invalid'))).toBe(true)
    expect(wrapper.find('.form-problems').text()).toContain('Two counters are called "HP"')
  })

  it('follows a sheet that changed elsewhere', async () => {
    const wrapper = mountEditor()
    await flushPromises()
    await wrapper.setProps({ modelValue: { subtitle: 'Brute', sections: [] } })
    expect(wrapper.find('input[placeholder^="Tier 1"]').element.value).toBe('Brute')
    expect(wrapper.findAll('input[aria-label="Counter name"]')).toHaveLength(0)
  })

  it('opens a sheet with something on it in preview, and Edit shows the builder', async () => {
    const wrapper = mountSheet()
    await flushPromises()
    expect(wrapper.find('.sheet-builder').exists()).toBe(false)
    expect(wrapper.find('.sheet-editor-preview .sheet-card').exists()).toBe(true)
    await button(wrapper, 'Edit').trigger('click')
    expect(wrapper.find('.sheet-builder').exists()).toBe(true)
    await button(wrapper, 'Preview').trigger('click')
    expect(wrapper.find('.sheet-builder').exists()).toBe(false)
  })

  it('opens an empty sheet (one just made) in Edit', async () => {
    const wrapper = mountSheet({})
    await flushPromises()
    expect(wrapper.find('.sheet-builder').exists()).toBe(true)
    expect(button(wrapper, 'Edit').attributes('aria-pressed')).toBe('true')
  })

  it('only shows the sheet without the right to edit', async () => {
    const wrapper = mountSheet(BUGBOAR, { canEdit: false })
    await flushPromises()
    expect(wrapper.find('.sheet-builder').exists()).toBe(false)
    expect(button(wrapper, 'Edit')).toBeUndefined()
    expect(wrapper.find('.sheet-editor-preview .sheet-card').exists()).toBe(true)
  })
})
