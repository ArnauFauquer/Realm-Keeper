// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

const { charactersApi, fetchSheet, fetchSheets, characters, push } = vi.hoisted(() => ({
  charactersApi: { reassign: vi.fn(), remove: vi.fn(), fetchAll: vi.fn() },
  fetchSheet: vi.fn(),
  fetchSheets: vi.fn(),
  characters: { stateOf: vi.fn(), statusOf: vi.fn(), adjust: vi.fn() },
  push: vi.fn()
}))
vi.mock('@/api/docs', () => ({ charactersApi }))
vi.mock('@/api/sheets', () => ({ fetchSheet, fetchSheets }))
vi.mock('@/composables/useCharacters', () => ({ useCharacters: () => characters }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))
vi.mock('@/config/env', () => ({ apiUrl: '' }))

const CharacterEditor = (await import('@/components/CharacterEditor.vue')).default

const ARIA = { id: 'aria', name: 'Aria', rev: 3, resources: { HP: { current: 4, max: 9, min: 0 } } }
const mountEditor = (props = {}) => mount(CharacterEditor, { props: { characterId: 'aria', canInteract: true, ...props } })

beforeEach(() => {
  characters.stateOf.mockReset().mockReturnValue(ARIA)
  characters.statusOf.mockReset().mockReturnValue('ready')
  characters.adjust.mockReset().mockResolvedValue({})
  fetchSheet.mockReset().mockResolvedValue({ note_id: 'Party/Aria', note_title: 'Aria', sheet: {} })
  fetchSheets.mockReset().mockResolvedValue([
    { id: 'aria', type: 'character', name: 'Aria' },
    { id: 'aria-la-roja', type: 'character', name: 'Aria la Roja' },
    { id: 'bugboar', type: 'adversary', name: 'Bugboar' }
  ])
  charactersApi.fetchAll.mockReset().mockResolvedValue([{ id: 'aria' }])
  charactersApi.reassign.mockReset().mockResolvedValue({ id: 'aria-la-roja' })
  charactersApi.remove.mockReset().mockResolvedValue({})
  push.mockReset()
  vi.restoreAllMocks()
})

describe('CharacterEditor', () => {
  it('shows the saved counters and where its sheet is', async () => {
    const wrapper = mountEditor()
    await flushPromises()
    expect(wrapper.find('.rc-value').text()).toBe('4 / 9')
    expect(wrapper.text()).toContain('Its sheet is in')
    await wrapper.find('.sheet-line a').trigger('click')
    expect(push).toHaveBeenCalledWith('/note/Party/Aria')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('says so when no sheet in the vault has its id any more', async () => {
    fetchSheet.mockRejectedValue({ response: { status: 404 } })
    const wrapper = mountEditor()
    await flushPromises()
    expect(wrapper.find('.orphan').text()).toContain('No sheet in the vault has the id aria')
  })

  it('changes a counter', async () => {
    const wrapper = mountEditor()
    await flushPromises()
    await wrapper.findAll('.rc-step')[0].trigger('click')
    expect(characters.adjust).toHaveBeenCalledWith('aria', 'HP', -1)
  })

  it('gives its values to another id, suggesting the sheets that have none', async () => {
    const wrapper = mountEditor()
    await flushPromises()
    expect(wrapper.findAll('datalist option').map((o) => o.attributes('value'))).toEqual(['aria-la-roja'])
    const button = wrapper.find('.reassign button')
    await wrapper.find('#reassign-id').setValue('Not An Id')
    expect(button.attributes('disabled')).toBeDefined()
    await wrapper.find('#reassign-id').setValue('aria')
    expect(button.attributes('disabled')).toBeDefined()           // its own id
    await wrapper.find('#reassign-id').setValue('aria-la-roja')
    await wrapper.find('.reassign').trigger('submit')
    await flushPromises()
    expect(charactersApi.reassign).toHaveBeenCalledWith('aria', 'aria-la-roja')
    expect(wrapper.emitted('gone')).toHaveLength(1)
  })

  it('shows what the server refused', async () => {
    charactersApi.reassign.mockRejectedValue({ response: { data: { detail: "There is already a character with the id 'bram'" } } })
    const wrapper = mountEditor()
    await flushPromises()
    await wrapper.find('#reassign-id').setValue('bram')
    await wrapper.find('.reassign').trigger('submit')
    await flushPromises()
    expect(wrapper.find('.rk-alert[role="alert"]').text()).toContain('already a character')
    expect(wrapper.emitted('gone')).toBeUndefined()
  })

  it('deletes the saved values after asking', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const wrapper = mountEditor()
    await flushPromises()
    await wrapper.find('.actions .danger').trigger('click')
    expect(charactersApi.remove).not.toHaveBeenCalled()
    confirm.mockReturnValue(true)
    await wrapper.find('.actions .danger').trigger('click')
    await flushPromises()
    expect(charactersApi.remove).toHaveBeenCalledWith('aria')
    expect(wrapper.emitted('gone')).toHaveLength(1)
  })

  it('can be looked at, not changed, by someone signed out', async () => {
    const wrapper = mountEditor({ canInteract: false })
    await flushPromises()
    expect(wrapper.find('.actions').exists()).toBe(false)
    expect(wrapper.find('.rc-step').exists()).toBe(false)
  })

  it('has its own words for loading and for one that is gone', () => {
    characters.statusOf.mockReturnValue('loading')
    expect(mountEditor().text()).toContain('Loading character')
    characters.statusOf.mockReturnValue('gone')
    characters.stateOf.mockReturnValue(null)
    expect(mountEditor().text()).toContain('moved or deleted')
  })
})
