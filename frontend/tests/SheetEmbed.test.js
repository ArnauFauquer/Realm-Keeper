// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

const { characters, adversariesApi, openModal } = vi.hoisted(() => ({
  characters: { stateOf: vi.fn(), status: { value: 'ready' }, adjust: vi.fn() },
  adversariesApi: { fetch: vi.fn() },
  openModal: vi.fn()
}))
vi.mock('@/composables/useCharacters', () => ({ useCharacters: () => characters }))
vi.mock('@/api/docs', () => ({ adversariesApi, encountersApi: { fetchAll: vi.fn() } }))
vi.mock('@/composables/useDocModal', () => ({ useDocModal: () => ({ open: openModal }) }))
vi.mock('@/composables/useDiceRoller', () => ({ useDiceRoller: () => ({ roll: vi.fn() }) }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/config/env', () => ({ apiUrl: '' }))

const SheetEmbed = (await import('@/components/SheetEmbed.vue')).default

const ARIA = { id: 'party/aria', name: 'Aria', source: 'subtitle: Ranger\nsections:\n  - counters: { HP: 9 }\n', resources: { HP: { current: 4, max: 9, min: 0 } } }
const BUGBOAR = { id: 'Bestiary/bugboar', name: 'Bugboar', source: 'sections:\n  - counters: { HP: 6 }\n' }
const embed = (props) => mount(SheetEmbed, { props: { canInteract: true, ...props } })

beforeEach(() => {
  characters.stateOf.mockReset().mockReturnValue(ARIA)
  characters.status.value = 'ready'
  characters.adjust.mockReset().mockResolvedValue({})
  adversariesApi.fetch.mockReset().mockResolvedValue(BUGBOAR)
  openModal.mockReset()
})

describe('SheetEmbed', () => {
  it("draws a character's sheet with its own counters, which are played from the note", async () => {
    const wrapper = embed({ type: 'character', id: 'party/aria' })
    await flushPromises()
    expect(wrapper.text()).toContain('Aria')
    expect(wrapper.text()).toContain('Ranger')
    expect(wrapper.find('.rc-value').text()).toBe('4 / 9')
    await wrapper.findAll('.rc-step')[0].trigger('click')
    expect(characters.adjust).toHaveBeenCalledWith('party/aria', 'HP', -1)
  })

  it('reads an adversary once, as a template', async () => {
    const wrapper = embed({ type: 'adversary', id: 'Bestiary/bugboar' })
    await flushPromises()
    expect(adversariesApi.fetch).toHaveBeenCalledWith('Bestiary/bugboar')
    expect(wrapper.text()).toContain('Bugboar')
    expect(wrapper.find('.rc-step').exists()).toBe(false)   // its counters belong to each copy in an encounter
  })

  it('opens it in its gallery to be edited', async () => {
    const wrapper = embed({ type: 'adversary', id: 'Bestiary/bugboar' })
    await flushPromises()
    await wrapper.findAll('button').find((b) => b.text().includes('Edit')).trigger('click')
    expect(openModal).toHaveBeenCalledWith('Bestiary/bugboar')
  })

  it('says so when what the link names is gone', async () => {
    adversariesApi.fetch.mockRejectedValue({ response: { status: 404 } })
    const wrapper = embed({ type: 'adversary', id: 'gone' })
    await flushPromises()
    expect(wrapper.text()).toContain('adversary:gone')
    expect(wrapper.text()).toContain('moved or deleted')
  })

  it('does not repeat a name the note already shows', async () => {
    const wrapper = embed({ type: 'character', id: 'party/aria', pageHeadings: ['Aria'] })
    await flushPromises()
    expect(wrapper.find('.sheet-name--hidden').exists()).toBe(true)
  })

  it('asks a signed-out reader to sign in, and fetches nothing', async () => {
    const wrapper = embed({ type: 'adversary', id: 'Bestiary/bugboar', canInteract: false })
    await flushPromises()
    expect(adversariesApi.fetch).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Sign in')
  })
})
