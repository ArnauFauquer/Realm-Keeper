// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'

const roll = vi.fn()
const push = vi.fn()
const { characters, useCharacters } = vi.hoisted(() => {
  const characters = {
    status: { value: 'ready' },
    stateOf: vi.fn(() => null),
    ensure: vi.fn(() => Promise.resolve({})),
    adjust: vi.fn(() => Promise.resolve({})),
    reconcile: vi.fn(() => Promise.resolve(null))
  }
  return { characters, useCharacters: vi.fn(() => characters) }
})
vi.mock('@/composables/useDiceRoller', () => ({ useDiceRoller: () => ({ roll }) }))
vi.mock('@/composables/useCharacters', () => ({ useCharacters }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))
vi.mock('@/config/env', () => ({ apiUrl: '' }))

const SheetBlock = (await import('@/components/SheetBlock.vue')).default

// A note's wikilinks reach the view already turned into markdown links.
const BUGBOAR = `
name: Bugboar
subtitle: Tier 1 · Bruiser
image: /api/asset-library/assets/asset-library/Bestiary/1a2b3c4d-bugboar.png
tags: [goblinoid]
resources:
  HP: 6
  Stress: { max: 3, start: 0 }
stats:
  Difficulty: 14
  Attack: { value: "+2", roll: "hf+2" }
  Notes: { value: sturdy, roll: "not dice" }
sections:
  - title: Actions
    items:
      - name: Gore
        roll: "1d20+3"
        cost: 1 Fear
        text: "Hits for \`1d8+2\` damage near [Goblin Cave](/note/Goblin%20Cave)."
text: |
  A tusked brute.
`

const mountSheet = (props = {}) => mount(SheetBlock, { props: { source: BUGBOAR, canInteract: true, ...props } })

beforeEach(() => {
  roll.mockClear()
  push.mockClear()
  useCharacters.mockClear()
  characters.stateOf.mockReset().mockReturnValue(null)
  characters.ensure.mockClear()
  characters.adjust.mockClear()
  characters.reconcile.mockClear()
})

describe('SheetBlock', () => {
  it('draws the sheet', () => {
    const wrapper = mountSheet()
    expect(wrapper.find('.sheet-name').text()).toBe('Bugboar')
    expect(wrapper.find('.sheet-type').text()).toBe('Adversary')
    expect(wrapper.text()).toContain('Tier 1 · Bruiser')
    expect(wrapper.find('.sheet-tag').text()).toBe('goblinoid')
    expect(wrapper.text()).toContain('Actions')
    expect(wrapper.text()).toContain('1 Fear')
    expect(wrapper.text()).toContain('A tusked brute.')
    expect(wrapper.findAll('.sheet-stat')).toHaveLength(3)
  })

  it('shows a template\'s counters at their starting value, read only', () => {
    const wrapper = mountSheet()
    const [hp, stress] = wrapper.findAll('.resource-counter')
    expect(hp.findAll('.rc-pip.filled')).toHaveLength(6)
    expect(stress.findAll('.rc-pip')).toHaveLength(3)
    expect(stress.findAll('.rc-pip.filled')).toHaveLength(0)
    expect(wrapper.find('.rc-step').exists()).toBe(false)
  })

  it('rolls a stat, labelled with the sheet and the stat', async () => {
    const wrapper = mountSheet()
    const buttons = wrapper.findAll('.sheet-stat .sheet-roll')
    expect(buttons).toHaveLength(1) // "not dice" is not a formula
    await buttons[0].trigger('click')
    expect(roll).toHaveBeenCalledWith('hf+2', { label: 'Bugboar · Attack' })
  })

  it('lays out groups of stats, sections and items in the columns asked for', () => {
    const wrapper = mountSheet({
      source: [
        'name: A',
        'columns: 2',
        'stats:',
        '  - { Evasion: 11 }',
        '  - title: Traits',
        '    columns: 6',
        '    stats: { Agility: 1, Strength: 0 }',
        'sections:',
        '  - { title: Skills, columns: 3, items: [Arcana, History] }',
        '  - { title: Features, wide: true, items: ["| Level | Die |\\n|---|---|\\n| 1 | `1d6` |"] }'
      ].join('\n')
    })
    const groups = wrapper.findAll('.sheet-stat-group')
    expect(groups).toHaveLength(2)
    expect(groups[1].find('.sheet-group-title').text()).toBe('Traits')
    expect(groups[1].find('.sheet-stats').attributes('style')).toContain('--sheet-columns: 6')
    expect(groups[0].find('.sheet-stats').classes()).not.toContain('sheet-grid--fixed')
    expect(wrapper.find('.sheet-sections').attributes('style')).toContain('--sheet-columns: 2')
    const [skills, features] = wrapper.findAll('.sheet-section')
    expect(skills.find('.sheet-items').attributes('style')).toContain('--sheet-columns: 3')
    expect(features.classes()).toContain('sheet-section--wide')
    expect(features.find('table td code.dice-roll').exists()).toBe(true)
  })

  it('rolls an action, and dice written in its text', async () => {
    const wrapper = mountSheet()
    await wrapper.find('.sheet-item .sheet-roll').trigger('click')
    expect(roll).toHaveBeenLastCalledWith('1d20+3', { label: 'Bugboar · Gore' })
    await wrapper.find('.sheet-item-text code.dice-roll').trigger('click')
    expect(roll).toHaveBeenLastCalledWith('1d8+2', { label: 'Bugboar · Gore' })
  })

  it('leaves other inline code as plain code', () => {
    const wrapper = mountSheet({ source: 'name: A\ntext: "see `chart:maps/town` and `song.mp3`"' })
    expect(wrapper.find('.doc-embed').exists()).toBe(false)
    expect(wrapper.find('.song-link').exists()).toBe(false)
    expect(wrapper.findAll('.sheet-text code')).toHaveLength(2)
  })

  it('routes a link to another note through the router', async () => {
    const wrapper = mountSheet()
    await wrapper.find('.sheet-item-text a').trigger('click')
    expect(push).toHaveBeenCalledWith('/note/Goblin%20Cave')
  })

  it('has no dice, library image or author warnings for someone signed out', async () => {
    const wrapper = mountSheet({ canInteract: false, source: BUGBOAR.replace('name: Bugboar', 'name: Bugboar\nunknown: 1') })
    expect(wrapper.find('.sheet-roll').exists()).toBe(false)
    expect(wrapper.find('.sheet-portrait').exists()).toBe(false)
    expect(wrapper.find('.sheet-warnings').exists()).toBe(false)
    await wrapper.find('.sheet-item-text code.dice-roll').trigger('click')
    expect(roll).not.toHaveBeenCalled()
  })

  it('shows the library image and the warnings to someone signed in', () => {
    const wrapper = mountSheet({ source: BUGBOAR.replace('name: Bugboar', 'name: Bugboar\nunknown: 1') })
    expect(wrapper.find('.sheet-portrait').attributes('src')).toContain('/api/asset-library/assets/')
    expect(wrapper.find('.sheet-warnings').text()).toContain("Unknown field 'unknown'")
  })

  it('tells a character apart from an adversary', () => {
    const wrapper = mountSheet({ source: 'name: Aria\nid: aria\ntype: character' })
    expect(wrapper.find('.sheet-type').text()).toBe('Character')
    expect(wrapper.classes()).toContain('sheet--character')
  })

  it('says why a sheet could not be read, and keeps its source visible', () => {
    const wrapper = mountSheet({ source: 'name: Imp\ntype: monster' })
    expect(wrapper.find('.sheet-error').text()).toContain('type must be one of')
    expect(wrapper.find('.sheet-source').text()).toContain('type: monster')
    expect(wrapper.find('.sheet-name').exists()).toBe(false)
  })

  it('does not run HTML written in a sheet', () => {
    const wrapper = mountSheet({ source: 'name: A\ntext: "<img src=x onerror=alert(1)> <script>alert(1)</script>"' })
    expect(wrapper.html()).not.toContain('onerror')
    expect(wrapper.html()).not.toContain('<script')
  })

  it('puts a sheet into an encounter under its note\'s reference', () => {
    const wrapper = mountSheet({ noteId: 'Bestiary/Bugboar' })
    expect(wrapper.findComponent({ name: 'AddToEncounter' }).props()).toMatchObject({ noteId: 'Bestiary/Bugboar' })
    expect(mountSheet({ canInteract: false }).find('.add-to-encounter').exists()).toBe(false)
  })

  describe('a character\'s saved counters', () => {
    const ARIA = 'name: Aria\nid: aria\ntype: character\nresources:\n  HP: 12\n  Hope: { max: 6, start: 2 }'
    const saved = { id: 'aria', resources: { HP: { current: 7, max: 12, min: 0 }, Hope: { current: 2, max: 6, min: 0 } } }

    it('creates them the first time a signed-in reader sees the sheet', async () => {
      mountSheet({ source: ARIA })
      await Promise.resolve()
      expect(characters.ensure).toHaveBeenCalledWith(expect.objectContaining({ id: 'aria', type: 'character' }))
      expect(characters.reconcile).not.toHaveBeenCalled()
    })

    it('shows the saved values and changes them', async () => {
      characters.stateOf.mockReturnValue(saved)
      const wrapper = mountSheet({ source: ARIA })
      await Promise.resolve()
      const hp = wrapper.findAll('.resource-counter')[0]
      expect(hp.find('.rc-value').text()).toBe('7 / 12')
      expect(hp.findAll('.rc-pip.filled')).toHaveLength(7)
      await hp.findAll('button')[0].trigger('click')
      expect(characters.adjust).toHaveBeenCalledWith('aria', 'HP', -1)
      expect(characters.ensure).not.toHaveBeenCalled()
      expect(characters.reconcile).toHaveBeenCalled() // the sheet may have changed since
    })

    it('follows its sheet when the sheet changes, not every time the saved values do', async () => {
      // Two blocks declaring the same id with different counters would otherwise
      // keep undoing each other: each one's change wakes the other.
      const doc = reactive({ characters: [saved] })
      characters.stateOf.mockImplementation((id) => doc.characters.find((c) => c.id === id) || null)
      const wrapper = mountSheet({ source: ARIA })
      await flushPromises()
      expect(characters.reconcile).toHaveBeenCalledTimes(1)

      doc.characters.splice(0, 1, { ...saved, resources: { ...saved.resources, HP: { current: 3, max: 99, min: 0 } } })
      await flushPromises()
      expect(characters.reconcile).toHaveBeenCalledTimes(1)

      await wrapper.setProps({ source: ARIA.replace('HP: 12', 'HP: 15') })
      await flushPromises()
      expect(characters.reconcile).toHaveBeenCalledTimes(2)
      expect(characters.reconcile).toHaveBeenLastCalledWith(expect.objectContaining({ resources: expect.objectContaining({ HP: expect.objectContaining({ max: 15 }) }) }))
    })

    it('keeps the counters read only until the character has a saved state', () => {
      const wrapper = mountSheet({ source: ARIA })
      expect(wrapper.find('.rc-step').exists()).toBe(false)
      expect(wrapper.findAll('.resource-counter')[1].findAll('.rc-pip.filled')).toHaveLength(2) // Hope starts at 2
    })

    it('is not followed by someone who is signed out, nor for an adversary', () => {
      mountSheet({ source: ARIA, canInteract: false })
      mountSheet()
      expect(useCharacters).not.toHaveBeenCalled()
    })
  })
})
