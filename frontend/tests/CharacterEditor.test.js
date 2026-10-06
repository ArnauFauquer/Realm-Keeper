// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

const { characters, state } = vi.hoisted(() => ({
  characters: { stateOf: vi.fn(), statusOf: vi.fn(), adjust: vi.fn(), patch: vi.fn() },
  state: { value: null }
}))
vi.mock('@/composables/useCharacters', () => ({ useCharacters: () => characters }))
vi.mock('@/composables/useDiceRoller', () => ({ useDiceRoller: () => ({ roll: vi.fn() }) }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/config/env', () => ({ apiUrl: '' }))

const CharacterEditor = (await import('@/components/CharacterEditor.vue')).default

const SHEET = { sections: [{ counters: [{ name: 'HP', max: 9 }] }] }
const ARIA = { id: 'party/aria', name: 'Aria', rev: 3, sheet: SHEET, resources: { HP: { current: 4, max: 9, min: 0 } } }
const mountEditor = (props = {}) => mount(CharacterEditor, { props: { characterId: 'party/aria', canInteract: true, ...props } })
const saveButton = (wrapper) => wrapper.findAll('button').find((b) => /Save/.test(b.text()))
const subtitle = (wrapper) => wrapper.find('input[placeholder^="Tier 1"]')

beforeEach(() => {
  state.value = ARIA
  characters.stateOf.mockReset().mockImplementation(() => state.value)
  characters.statusOf.mockReset().mockReturnValue('ready')
  characters.adjust.mockReset().mockResolvedValue({})
  characters.patch.mockReset().mockResolvedValue({})
  vi.restoreAllMocks()
})

describe('CharacterEditor', () => {
  it("shows its sheet's builder beside the sheet, with the character's own counters", async () => {
    const wrapper = mountEditor()
    await flushPromises()
    expect(wrapper.find('input[aria-label="Counter name"]').element.value).toBe('HP')
    expect(wrapper.find('.rc-value').text()).toBe('4 / 9')
    expect(wrapper.text()).toContain('character:party/aria')
    expect(saveButton(wrapper).attributes('disabled')).toBeDefined()   // nothing to save yet
  })

  it('changes a counter, live', async () => {
    const wrapper = mountEditor()
    await flushPromises()
    await wrapper.findAll('.rc-step')[0].trigger('click')
    expect(characters.adjust).toHaveBeenCalledWith('party/aria', 'HP', -1)
  })

  it('saves the sheet with its own button', async () => {
    const wrapper = mountEditor()
    await flushPromises()
    await subtitle(wrapper).setValue('Ranger')
    expect(wrapper.find('.sheet-editor-preview').text()).toContain('Ranger')   // the preview follows
    await saveButton(wrapper).trigger('click')
    await flushPromises()
    const [, { sheet }] = characters.patch.mock.calls[0]
    expect(sheet.subtitle).toBe('Ranger')
    expect(sheet.sections[0].counters[0]).toMatchObject({ name: 'HP', max: 9 })
  })

  it('is no longer unsaved once what was typed is undone', async () => {
    const wrapper = mountEditor()
    await flushPromises()
    await subtitle(wrapper).setValue('Ranger')
    expect(saveButton(wrapper).attributes('disabled')).toBeUndefined()
    await subtitle(wrapper).setValue('')
    expect(saveButton(wrapper).attributes('disabled')).toBeDefined()
  })

  it('shows what the server refused', async () => {
    characters.patch.mockRejectedValue({ response: { data: { detail: 'The document is too large' } } })
    const wrapper = mountEditor()
    await flushPromises()
    await subtitle(wrapper).setValue('Ranger')
    await saveButton(wrapper).trigger('click')
    await flushPromises()
    expect(wrapper.find('.save-error').text()).toContain('too large')
  })

  it('offers a template for an empty sheet', async () => {
    state.value = { ...ARIA, sheet: { sections: [] }, resources: {} }
    const wrapper = mountEditor()
    await flushPromises()
    await wrapper.findAll('button').find((b) => b.text().includes('template')).trigger('click')
    expect(wrapper.findAll('input[aria-label="Counter name"]').length).toBeGreaterThan(0)
  })

  it('says so when the character is gone', async () => {
    state.value = null
    const wrapper = mountEditor()
    await flushPromises()
    expect(wrapper.text()).toContain('moved or deleted')
  })
})
