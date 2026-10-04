// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

const { encountersApi, charactersApi, openModal } = vi.hoisted(() => ({
  encountersApi: { fetchAll: vi.fn(), fetch: vi.fn(), commands: { addItems: vi.fn() } },
  charactersApi: { ensure: vi.fn() },
  openModal: vi.fn()
}))
vi.mock('@/api/docs', () => ({ encountersApi, charactersApi }))
vi.mock('@/composables/useDocModal', () => ({ useDocModal: () => ({ open: openModal }) }))

const AddToEncounter = (await import('@/components/AddToEncounter.vue')).default

const BUGBOAR = { id: 'bugboar', name: 'Bugboar', type: 'adversary', image: null, resources: { HP: { max: 6, min: 0, start: null } } }
const ARIA = { id: 'aria', name: 'Aria', type: 'character', image: null, resources: { HP: { max: 12, min: 0, start: null } } }

async function opened(sheet = BUGBOAR, current = { combatants: [] }) {
  encountersApi.fetchAll.mockResolvedValue([{ id: 'goblins/cave', name: 'Cave' }, { id: 'ambush', name: 'Ambush' }])
  encountersApi.fetch.mockResolvedValue(current)
  encountersApi.commands.addItems.mockResolvedValue({})
  charactersApi.ensure.mockResolvedValue({ created: true })
  const wrapper = mount(AddToEncounter, { props: { sheet, noteId: 'Bestiary/Bugboar' } })
  await wrapper.find('button').trigger('click')
  await flushPromises()
  return wrapper
}

beforeEach(() => vi.clearAllMocks())

describe('AddToEncounter', () => {
  it('offers the encounters, and fetches nothing until it is opened', async () => {
    const wrapper = mount(AddToEncounter, { props: { sheet: BUGBOAR, noteId: 'n' } })
    expect(wrapper.find('select').exists()).toBe(false)
    expect(encountersApi.fetchAll).not.toHaveBeenCalled()
    encountersApi.fetchAll.mockResolvedValue([{ id: 'goblins/cave', name: 'Cave' }, { id: 'ambush', name: 'Ambush' }])
    await wrapper.find('button').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('option').map((o) => o.text())).toEqual(['goblins/cave', 'Ambush'])
  })

  it('says so when there are no encounters', async () => {
    encountersApi.fetchAll.mockResolvedValue([])
    const wrapper = mount(AddToEncounter, { props: { sheet: BUGBOAR, noteId: 'n' } })
    await wrapper.find('button').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('no encounters yet')
  })

  it("adds copies of an adversary, numbered after the ones already there, under its note's reference", async () => {
    const existing = { combatants: [{ id: 'x', type: 'adversary', sheet: 'Bestiary/Bugboar#bugboar', name: 'Bugboar' }] }
    const wrapper = await opened(BUGBOAR, existing)
    await wrapper.find('input[type="number"]').setValue(3)
    await wrapper.findAll('button')[1].trigger('click')
    await flushPromises()
    expect(encountersApi.fetch).toHaveBeenCalledWith('goblins/cave')
    const [id, collection, items] = encountersApi.commands.addItems.mock.calls[0]
    expect([id, collection]).toEqual(['goblins/cave', 'combatants'])
    expect(items.map((i) => i.name)).toEqual(['Bugboar 2', 'Bugboar 3', 'Bugboar 4'])
    expect(items[0]).toMatchObject({ type: 'adversary', sheet: 'Bestiary/Bugboar#bugboar', resources: { HP: { current: 6, max: 6 } } })
    expect(charactersApi.ensure).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('3 copies added')
  })

  it('adds a character once, after making sure its saved counters exist', async () => {
    const wrapper = await opened(ARIA)
    expect(wrapper.find('input[type="number"]').exists()).toBe(false)
    await wrapper.findAll('button')[1].trigger('click')
    await flushPromises()
    expect(charactersApi.ensure).toHaveBeenCalledWith(
      'aria', expect.objectContaining({ name: 'Aria', resources: { HP: expect.objectContaining({ current: 12, max: 12 }) } })
    )
    const [, , items] = encountersApi.commands.addItems.mock.calls[0]
    expect(items).toEqual([{ name: 'Aria', type: 'character', sheet: 'aria', image_url: null }])
  })

  it('refuses a character that is already in it', async () => {
    const wrapper = await opened(ARIA, { combatants: [{ id: 'c', type: 'character', sheet: 'aria' }] })
    await wrapper.findAll('button')[1].trigger('click')
    await flushPromises()
    expect(encountersApi.commands.addItems).not.toHaveBeenCalled()
    expect(wrapper.find('[role="status"]').text()).toContain('already in this encounter')
  })

  it('shows what the server refused', async () => {
    const wrapper = await opened()
    encountersApi.commands.addItems.mockRejectedValue({ response: { data: { detail: 'The document is too large' } } })
    await wrapper.findAll('button')[1].trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="status"]').text()).toContain('too large')
  })

  it('opens the encounter it added to', async () => {
    const wrapper = await opened()
    await wrapper.findAll('button')[1].trigger('click')
    await flushPromises()
    await wrapper.find('.add-open').trigger('click')
    expect(openModal).toHaveBeenCalledWith('goblins/cave')
  })
})
