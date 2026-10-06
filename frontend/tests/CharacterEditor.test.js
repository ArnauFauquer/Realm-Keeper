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

const SOURCE = 'sections:\n  - counters:\n      HP: 9\n'
const ARIA = { id: 'party/aria', name: 'Aria', rev: 3, source: SOURCE, resources: { HP: { current: 4, max: 9, min: 0 } } }
const mountEditor = (props = {}) => mount(CharacterEditor, { props: { characterId: 'party/aria', canInteract: true, ...props } })
const saveButton = (wrapper) => wrapper.findAll('button').find((b) => /Save/.test(b.text()))
// What is typed is parsed once typing pauses (SheetEditor's PARSE_DELAY).
const typingPause = async () => {
  await new Promise((resolve) => setTimeout(resolve, 200))
  await flushPromises()
}

beforeEach(() => {
  state.value = ARIA
  characters.stateOf.mockReset().mockImplementation(() => state.value)
  characters.statusOf.mockReset().mockReturnValue('ready')
  characters.adjust.mockReset().mockResolvedValue({})
  characters.patch.mockReset().mockResolvedValue({})
  vi.restoreAllMocks()
})

describe('CharacterEditor', () => {
  it("shows its sheet's YAML beside the sheet, with the character's own counters", async () => {
    const wrapper = mountEditor()
    await flushPromises()
    expect(wrapper.find('textarea').element.value).toBe(SOURCE)
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
    await wrapper.find('textarea').setValue(`${SOURCE}subtitle: Ranger\n`)
    expect(wrapper.text()).not.toContain('Ranger')                       // not at every keystroke...
    await typingPause()
    expect(wrapper.text()).toContain('Ranger')                           // ...but the preview follows
    await saveButton(wrapper).trigger('click')
    await flushPromises()
    expect(characters.patch).toHaveBeenCalledWith('party/aria', { source: `${SOURCE}subtitle: Ranger\n` })
  })

  it('keeps the last valid sheet in the preview while the YAML is half typed, and says so', async () => {
    const wrapper = mountEditor()
    await flushPromises()
    await wrapper.find('textarea').setValue('sections:\n  - counters: { HP: lots }')
    await typingPause()
    expect(wrapper.find('.source-error').text()).toContain('whole number')
    expect(wrapper.find('.rc-value').text()).toBe('4 / 9')
  })

  it('shows what the server refused', async () => {
    characters.patch.mockRejectedValue({ response: { data: { detail: 'The document is too large' } } })
    const wrapper = mountEditor()
    await flushPromises()
    await wrapper.find('textarea').setValue(`${SOURCE}# more\n`)
    await saveButton(wrapper).trigger('click')
    await flushPromises()
    expect(wrapper.find('.save-error').text()).toContain('too large')
  })

  it('offers a template for an empty sheet', async () => {
    state.value = { ...ARIA, source: '', resources: {} }
    const wrapper = mountEditor()
    await flushPromises()
    await wrapper.findAll('button').find((b) => b.text().includes('template')).trigger('click')
    expect(wrapper.find('textarea').element.value).toContain('sections:')
  })

  it('says so when the character is gone', async () => {
    state.value = null
    const wrapper = mountEditor()
    await flushPromises()
    expect(wrapper.text()).toContain('moved or deleted')
  })
})
