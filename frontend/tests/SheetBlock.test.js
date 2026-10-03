// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

const roll = vi.fn()
const push = vi.fn()
vi.mock('@/composables/useDiceRoller', () => ({ useDiceRoller: () => ({ roll }) }))
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
})
