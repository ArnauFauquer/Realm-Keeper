// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import * as fake from './helpers/fakeSyncedDoc'

const { commands, fetchSheets, fetchSheet } = vi.hoisted(() => ({
  commands: {
    patch: vi.fn(), patchItem: vi.fn(), addItems: vi.fn(), removeItem: vi.fn(), orderItems: vi.fn(), adjust: vi.fn()
  },
  fetchSheets: vi.fn(),
  fetchSheet: vi.fn()
}))

vi.mock('@/composables/useSyncedDoc', async () => {
  const helper = await import('./helpers/fakeSyncedDoc')
  return { useSyncedDoc: () => ({ doc: helper.doc, status: helper.status, error: helper.error, commit: helper.commit }) }
})
vi.mock('@/composables/useCharacters', async () => {
  const helper = await import('./helpers/fakeSyncedDoc')
  return { useCharacters: () => helper.characters }
})
vi.mock('@/composables/syncSocket', async () => {
  const { ref } = await import('vue')
  return { syncStatus: ref('open') }
})
vi.mock('@/api/docs', () => ({ encountersApi: { commands } }))
vi.mock('@/api/sheets', () => ({ fetchSheets, fetchSheet }))
vi.mock('@/composables/useDiceRoller', () => ({ useDiceRoller: () => ({ roll: vi.fn() }) }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/config/env', () => ({ apiUrl: '' }))

const EncounterTracker = (await import('@/components/EncounterTracker.vue')).default

const HP = (current) => ({ current, max: 6, min: 0, color: null, style: null })
const encounter = (overrides = {}) => ({
  id: 'fight', name: 'Fight', rev: 1,
  combatants: [
    { id: 'a', name: 'Bugboar 1', type: 'adversary', sheet: 'n#bugboar', resources: { HP: HP(4) }, conditions: [], notes: '', defeated: false },
    { id: 'b', name: 'Bugboar 2', type: 'adversary', sheet: 'n#bugboar', resources: { HP: HP(6) }, conditions: [{ id: 'c1', name: 'Prone' }], notes: 'hi', defeated: false },
    { id: 'c', name: 'Aria', type: 'character', sheet: 'aria', resources: {}, conditions: [], notes: '', defeated: false }
  ],
  ...overrides
})

const mountTracker = (props = {}) => mount(EncounterTracker, { props: { encounterId: 'fight', canInteract: true, ...props } })
const cards = (wrapper) => wrapper.findAll('.combatant')

beforeEach(() => {
  fake.reset(encounter())
  Object.values(commands).forEach((command) => command.mockReset().mockResolvedValue({}))
  fetchSheets.mockReset().mockResolvedValue([])
  fetchSheet.mockReset()
  vi.restoreAllMocks()
})

describe('EncounterTracker', () => {
  it('shows who is in the encounter, each with their own counters', () => {
    const wrapper = mountTracker()
    expect(cards(wrapper).map((c) => c.find('.name-input').element.value)).toEqual(['Bugboar 1', 'Bugboar 2', 'Aria'])
    expect(cards(wrapper)[0].find('.rc-value').text()).toBe('4 / 6')
    expect(cards(wrapper)[1].find('.rc-value').text()).toBe('6 / 6')
    expect(cards(wrapper)[1].text()).toContain('Prone')
    expect(wrapper.text()).toContain('Live')
  })

  it("shows a character's saved counters, not the encounter's", () => {
    fake.characters.stateOf.mockImplementation((id) => (id === 'aria' ? { id, resources: { HP: { current: 9, max: 12, min: 0 } } } : null))
    const wrapper = mountTracker()
    expect(cards(wrapper)[2].find('.rc-value').text()).toBe('9 / 12')
  })

  it("adjusts an adversary's counter in the encounter, and a character's in its saved state", async () => {
    fake.characters.stateOf.mockReturnValue({ id: 'aria', resources: { HP: { current: 9, max: 12, min: 0 } } })
    const wrapper = mountTracker()
    await cards(wrapper)[0].findAll('.rc-step')[0].trigger('click')
    expect(commands.adjust).toHaveBeenCalledWith('fight', 'combatants', 'a', 'HP', -1)
    expect(fake.commit).toHaveBeenCalled()
    await cards(wrapper)[2].findAll('.rc-step')[1].trigger('click')
    expect(fake.characters.adjust).toHaveBeenCalledWith('aria', 'HP', 1)
    expect(commands.adjust).toHaveBeenCalledTimes(1)
  })

  it('edits a combatant: name, defeated, notes and conditions', async () => {
    const wrapper = mountTracker()
    const card = cards(wrapper)[0]
    const name = card.find('.name-input')
    name.element.value = '  Big one '
    await name.trigger('change')
    expect(commands.patchItem).toHaveBeenLastCalledWith('fight', 'combatants', 'a', { name: 'Big one' })

    await card.find('.head-actions button:nth-child(3)').trigger('click')
    expect(commands.patchItem).toHaveBeenLastCalledWith('fight', 'combatants', 'a', { defeated: true })

    const notes = card.find('textarea')
    notes.element.value = 'bleeding'
    await notes.trigger('change')
    expect(commands.patchItem).toHaveBeenLastCalledWith('fight', 'combatants', 'a', { notes: 'bleeding' })

    const input = card.find('.condition-input')
    input.element.value = 'Poisoned'
    await input.trigger('keyup.enter')
    expect(commands.patchItem).toHaveBeenLastCalledWith('fight', 'combatants', 'a', {
      conditions: [expect.objectContaining({ name: 'Poisoned' })]
    })

    await cards(wrapper)[1].find('.condition-remove').trigger('click')
    expect(commands.patchItem).toHaveBeenLastCalledWith('fight', 'combatants', 'b', { conditions: [] })
  })

  it("has no rounds, turns or initiative: the order is the table's own", () => {
    const wrapper = mountTracker()
    expect(wrapper.text().toLowerCase()).not.toMatch(/round|turn|initiative/)
    expect(wrapper.find('.turn-marker').exists()).toBe(false)
    expect(wrapper.find('.initiative').exists()).toBe(false)
  })

  it('moves one place with the arrows, and not past either end', async () => {
    const wrapper = mountTracker()
    expect(cards(wrapper)[0].find('.head-actions button:nth-child(1)').attributes('disabled')).toBeDefined()
    expect(cards(wrapper)[2].find('.head-actions button:nth-child(2)').attributes('disabled')).toBeDefined()
    await cards(wrapper)[0].find('.head-actions button:nth-child(2)').trigger('click') // down
    expect(commands.orderItems).toHaveBeenLastCalledWith('fight', 'combatants', ['b', 'a', 'c'])
    await cards(wrapper)[2].find('.head-actions button:nth-child(1)').trigger('click') // up
    expect(commands.orderItems).toHaveBeenLastCalledWith('fight', 'combatants', ['a', 'c', 'b'])
  })

  it('removes after asking', async () => {
    const wrapper = mountTracker()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await cards(wrapper)[0].find('.head-actions .danger').trigger('click')
    expect(commands.removeItem).not.toHaveBeenCalled()
    confirm.mockReturnValue(true)
    await cards(wrapper)[0].find('.head-actions .danger').trigger('click')
    expect(commands.removeItem).toHaveBeenCalledWith('fight', 'combatants', 'a')
  })

  describe('dragging', () => {
    // jsdom has no layout: every card is 100px tall, stacked from the top.
    const layout = (wrapper) =>
      cards(wrapper).forEach((card, index) => {
        card.element.getBoundingClientRect = () => ({ top: index * 100, height: 100, bottom: index * 100 + 100 })
      })
    const dataTransfer = () => ({ setData: vi.fn(), setDragImage: vi.fn(), effectAllowed: '', dropEffect: '' })
    const handle = (wrapper, index) => cards(wrapper)[index].find('.drag-handle')
    const dragOver = (wrapper, index, clientY) => cards(wrapper)[index].trigger('dragover', { clientY, dataTransfer: dataTransfer() })

    it('puts the dragged one where it is dropped', async () => {
      const wrapper = mountTracker()
      layout(wrapper)
      const transfer = dataTransfer()
      await handle(wrapper, 0).trigger('dragstart', { dataTransfer: transfer })
      expect(transfer.setData).toHaveBeenCalled() // Firefox won't drag without data
      expect(transfer.setDragImage).toHaveBeenCalledWith(cards(wrapper)[0].element, expect.any(Number), expect.any(Number))
      expect(cards(wrapper)[0].classes()).toContain('is-dragged')

      await dragOver(wrapper, 2, 280) // the lower half of the last card: after it
      expect(cards(wrapper)[2].classes()).toContain('drop-after')
      await cards(wrapper)[2].trigger('drop', { dataTransfer: dataTransfer() })
      expect(commands.orderItems).toHaveBeenCalledWith('fight', 'combatants', ['b', 'c', 'a'])
      expect(cards(wrapper).some((card) => card.classes().includes('is-dragged'))).toBe(false)
    })

    it('can drop before a card too, on its upper half', async () => {
      const wrapper = mountTracker()
      layout(wrapper)
      await handle(wrapper, 2).trigger('dragstart', { dataTransfer: dataTransfer() })
      await dragOver(wrapper, 0, 10)
      expect(cards(wrapper)[0].classes()).toContain('drop-before')
      await cards(wrapper)[0].trigger('drop', { dataTransfer: dataTransfer() })
      expect(commands.orderItems).toHaveBeenCalledWith('fight', 'combatants', ['c', 'a', 'b'])
    })

    it('shows no mark, and sends nothing, where nothing would move', async () => {
      const wrapper = mountTracker()
      layout(wrapper)
      await handle(wrapper, 1).trigger('dragstart', { dataTransfer: dataTransfer() })
      await dragOver(wrapper, 1, 120) // on itself
      await dragOver(wrapper, 2, 210) // just before the one after it: the same place
      expect(wrapper.findAll('.drop-before, .drop-after')).toHaveLength(0)
      await cards(wrapper)[2].trigger('drop', { dataTransfer: dataTransfer() })
      expect(commands.orderItems).not.toHaveBeenCalled()
    })

    it('forgets a drag that was let go outside the list', async () => {
      const wrapper = mountTracker()
      layout(wrapper)
      await handle(wrapper, 0).trigger('dragstart', { dataTransfer: dataTransfer() })
      await dragOver(wrapper, 1, 120)
      await handle(wrapper, 0).trigger('dragend')
      expect(wrapper.findAll('.is-dragged, .drop-before, .drop-after')).toHaveLength(0)
      expect(commands.orderItems).not.toHaveBeenCalled()
    })

    it('ignores what is dragged over it that is not one of its own', async () => {
      const wrapper = mountTracker()
      layout(wrapper)
      await dragOver(wrapper, 1, 120)
      await cards(wrapper)[1].trigger('drop', { dataTransfer: dataTransfer() })
      expect(wrapper.findAll('.drop-before, .drop-after')).toHaveLength(0)
      expect(commands.orderItems).not.toHaveBeenCalled()
    })

    it('has no handle for someone who may not change anything', () => {
      expect(mountTracker({ canInteract: false }).find('.drag-handle').exists()).toBe(false)
    })
  })

  it("shows a combatant's sheet when its details are opened, once", async () => {
    fetchSheet.mockResolvedValue({ sheet: {
      id: 'bugboar', name: 'Bugboar', type: 'adversary', tags: [], resources: {}, text: null,
      stats: [{ label: 'Difficulty', value: 14, roll: null }], sections: []
    } })
    const wrapper = mountTracker()
    const details = cards(wrapper)[0].find('details')
    details.element.open = true
    await details.trigger('toggle')
    await flushPromises()
    expect(fetchSheet).toHaveBeenCalledWith('n#bugboar')
    expect(cards(wrapper)[0].text()).toContain('Difficulty')
    const second = cards(wrapper)[1].find('details')
    second.element.open = true
    await second.trigger('toggle')
    expect(fetchSheet).toHaveBeenCalledTimes(1) // the same sheet
  })

  it('says when a sheet is gone from the vault', async () => {
    fetchSheet.mockRejectedValue({ response: { status: 404 } })
    const wrapper = mountTracker()
    const details = cards(wrapper)[0].find('details')
    details.element.open = true
    await details.trigger('toggle')
    await flushPromises()
    expect(cards(wrapper)[0].text()).toContain('no longer in the vault')
  })

  it('adds adversaries and characters from their sheets', async () => {
    fetchSheets.mockResolvedValue([
      { ref: 'n#imp', id: 'imp', name: 'Imp', type: 'adversary', tags: [], note_title: 'Callout', resources: { HP: { max: 3, min: 0, start: null } } },
      { ref: 'bram', id: 'bram', name: 'Bram', type: 'character', tags: [], note_title: 'Party', resources: { HP: { max: 8, min: 0, start: null } } }
    ])
    const wrapper = mountTracker()
    await wrapper.find('.tracker-bar > .rk-btn:last-child').trigger('click')
    await flushPromises()
    const rows = wrapper.findAll('.add-row')
    expect(rows).toHaveLength(2)

    await rows[0].find('input').setValue(2)
    await rows[0].find('button').trigger('click')
    const [, , items] = commands.addItems.mock.calls[0]
    expect(items.map((i) => i.name)).toEqual(['Imp 1', 'Imp 2'])

    await rows[1].find('button').trigger('click')
    await flushPromises()
    expect(fake.characters.ensure).toHaveBeenCalledWith(expect.objectContaining({ id: 'bram' }))
    expect(commands.addItems.mock.calls[1][2]).toEqual([{ name: 'Bram', type: 'character', sheet: 'bram', image_url: null }])

    await wrapper.find('.add-custom input').setValue('Guard')
    await wrapper.find('.add-custom').trigger('submit')
    expect(commands.addItems.mock.calls[2][2]).toEqual([{ name: 'Guard', type: 'adversary', resources: {} }])
  })

  it('does not add a character whose saved counters could not be created', async () => {
    fetchSheets.mockResolvedValue([{ ref: 'bram', id: 'bram', name: 'Bram', type: 'character', tags: [], note_title: 'Party', resources: {} }])
    fake.characters.ensure.mockRejectedValue(new Error('no storage'))
    const wrapper = mountTracker()
    await wrapper.find('.tracker-bar > .rk-btn:last-child').trigger('click')
    await flushPromises()
    await wrapper.find('.add-row button').trigger('click')
    await flushPromises()
    expect(commands.addItems).not.toHaveBeenCalled()
    expect(wrapper.find('.rk-alert').text()).toContain('no storage')
  })

  it('shows what the server refused', async () => {
    commands.adjust.mockRejectedValue({ response: { data: { detail: 'No resource HP' } } })
    const wrapper = mountTracker()
    await cards(wrapper)[0].findAll('.rc-step')[0].trigger('click')
    await flushPromises()
    expect(wrapper.find('.rk-alert').text()).toContain('No resource HP')
  })

  it('can be looked at, not changed, by someone signed out', () => {
    const wrapper = mountTracker({ canInteract: false })
    expect(wrapper.find('.rc-step').exists()).toBe(false)
    expect(wrapper.find('.name-input').attributes('disabled')).toBeDefined()
    expect(wrapper.findAll('.tracker-bar .rk-btn').map((b) => b.text()).join(' ')).not.toContain('Add')
    expect(wrapper.find('.head-actions button').attributes('disabled')).toBeDefined()
  })

  it('has its own words for loading, a missing encounter and a failure', () => {
    fake.status.value = 'loading'
    expect(mountTracker().text()).toContain('Loading encounter')
    fake.status.value = 'gone'
    expect(mountTracker().text()).toContain('moved or deleted')
    fake.status.value = 'error'
    fake.error.value = 'boom'
    expect(mountTracker().text()).toContain('boom')
  })

  it('invites you to add the first ones to an empty encounter', () => {
    fake.reset(encounter({ combatants: [] }))
    expect(mountTracker().text()).toContain('Nobody is in this encounter yet')
  })
})
