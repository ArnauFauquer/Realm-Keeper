// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

vi.mock('@/config/env', () => ({ apiUrl: '' }))
// The sheet itself has its own tests: here it only has to be handed the
// right things, and draw the counters it is given.
vi.mock('@/components/SheetView.vue', () => ({
  default: {
    name: 'SheetView',
    props: ['sheet', 'canInteract', 'showHeader', 'rollerName'],
    emits: ['rolled'],
    template: '<div class="sheet"><slot v-for="name in Object.keys(sheet.resources)" :key="name" name="counter" :resource="{ name, ...sheet.resources[name] }" /></div>'
  }
}))

const CombatantPlay = (await import('@/components/CombatantPlay.vue')).default

const SHEET = { name: 'Bugboar', subtitle: 'Tier 1 bruiser', image: null, resources: { HP: { max: 6, min: 0, start: null }, Stress: { max: 3, min: 0, start: 0 } }, sections: [] }
const BUGBOAR = { id: 'c1', name: 'Bugboar 2', type: 'adversary', sheet: 'bestiary/bugboar', conditions: [{ id: 'p', name: 'Prone' }], notes: '', defeated: false }
const COUNTERS = [{ name: 'HP', current: 4, max: 6, min: 0 }, { name: 'Rage', current: 1, max: 3, min: 0 }]

const mountPlay = (props = {}) => mount(CombatantPlay, {
  props: { combatant: BUGBOAR, counters: COUNTERS, sheetState: { status: 'ready', sheet: SHEET }, canInteract: true, ...props }
})

describe('CombatantPlay', () => {
  it('names the combatant, not its sheet, and rolls as it', () => {
    const wrapper = mountPlay()
    expect(wrapper.find('.play-name').text()).toBe('Bugboar 2')
    expect(wrapper.find('.play-subtitle').text()).toBe('Tier 1 bruiser')
    const sheet = wrapper.findComponent({ name: 'SheetView' })
    expect(sheet.props()).toMatchObject({ rollerName: 'Bugboar 2', showHeader: false, canInteract: true })
    sheet.vm.$emit('rolled', { label: 'Gore', formula: '1d8', total: 6 })
    expect(wrapper.emitted('rolled')).toEqual([[{ label: 'Gore', formula: '1d8', total: 6, combatant: 'c1' }]]) // whose, with it
  })

  it('plays its own counters from the sheet, and the ones the sheet lacks apart', async () => {
    const wrapper = mountPlay()
    const inSheet = wrapper.findAll('.sheet .resource-counter')
    expect(inSheet.map((c) => c.find('.rc-value').text())).toEqual(['4 / 6', '3'])
    // Stress isn't the combatant's: shown from the sheet, not playable.
    expect(inSheet[1].find('button').exists()).toBe(false)
    await inSheet[0].findAll('button')[0].trigger('click')
    expect(wrapper.emitted('adjust')).toEqual([['HP', -1]])

    const loose = wrapper.findAll('.play-counters .resource-counter')
    expect(loose.map((c) => c.find('.rc-name').text())).toEqual(['Rage'])
  })

  it('asks for its conditions, defeat and notes to change', async () => {
    const wrapper = mountPlay()
    const input = wrapper.find('.condition-input')
    input.element.value = ' Hidden '
    await input.trigger('keyup.enter')
    expect(wrapper.emitted('add-condition')).toEqual([['Hidden']])
    await wrapper.find('.condition-remove').trigger('click')
    expect(wrapper.emitted('remove-condition')).toEqual([[{ id: 'p', name: 'Prone' }]])

    await wrapper.find('.play-actions button').trigger('click')
    expect(wrapper.emitted('patch')).toEqual([[{ defeated: true }]])
    const notes = wrapper.find('textarea')
    notes.element.value = 'Hates fire'
    await notes.trigger('change')
    expect(wrapper.emitted('patch')[1]).toEqual([{ notes: 'Hates fire' }])

    await wrapper.find('button[aria-label^="Edit"]').trigger('click')
    expect(wrapper.emitted('edit-sheet')).toHaveLength(1)
  })

  it('says when its sheet is on its way or gone, and still plays its counters', () => {
    expect(mountPlay({ sheetState: { status: 'loading' } }).text()).toContain('Loading the sheet')
    const gone = mountPlay({ sheetState: { status: 'missing' } })
    expect(gone.text()).toContain('sheet is gone')
    expect(gone.findAll('.play-counters .resource-counter')).toHaveLength(2)
  })

  it('only shows, to someone who may not change it', () => {
    const wrapper = mountPlay({ canInteract: false })
    expect(wrapper.find('.condition-input').exists()).toBe(false)
    expect(wrapper.find('.play-actions button').attributes('disabled')).toBeDefined()
    expect(wrapper.find('button[aria-label^="Edit"]').exists()).toBe(false)
    expect(wrapper.find('textarea').attributes('disabled')).toBeDefined()
  })
})
