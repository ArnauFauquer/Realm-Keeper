// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import * as fake from './helpers/fakeSyncedDoc'

const { commands, fetchAll, post, encounter } = vi.hoisted(() => ({
  commands: { patch: vi.fn(), patchItem: vi.fn(), addItems: vi.fn(), removeItem: vi.fn() },
  fetchAll: vi.fn(),
  post: vi.fn(),
  encounter: { value: null }
}))

vi.mock('@/composables/useSyncedDoc', async () => {
  const helper = await import('./helpers/fakeSyncedDoc')
  const { computed } = await import('vue')
  return {
    useSyncedDoc: () => ({ doc: helper.doc, status: helper.status, error: helper.error, commit: helper.commit }),
    useSyncedDocFollowing: () => ({ doc: computed(() => encounter.value), status: ref('ready') })
  }
})
vi.mock('@/composables/useCharacters', async () => {
  const helper = await import('./helpers/fakeSyncedDoc')
  return { useCharacters: () => ({ ...helper.characters, docs: ref({}) }) }
})
vi.mock('@/composables/syncSocket', () => ({ syncStatus: ref('open') }))
vi.mock('@/api/docs', () => ({ battlemapsApi: { commands }, encountersApi: { fetchAll, fetch: vi.fn() } }))
vi.mock('@/api/http', async (importOriginal) => ({ ...(await importOriginal()), post }))
vi.mock('@/config/env', () => ({ apiUrl: '' }))
// The canvas has its own tests; here it only has to pass things on.
vi.mock('@/components/BattlemapCanvas.vue', () => ({
  default: {
    name: 'BattlemapCanvas',
    props: ['imageUrl', 'grid', 'tokens', 'selectedId', 'tool', 'editable'],
    emits: ['select', 'moving', 'move'],
    template: '<div class="canvas"><slot name="empty" /></div>'
  }
}))
vi.mock('@/components/AssetLibraryModal.vue', () => ({
  default: { name: 'AssetLibraryModal', props: ['isOpen'], emits: ['close', 'select'], template: '<div class="library" />' }
}))

const BattlemapEditor = (await import('@/components/BattlemapEditor.vue')).default

const GRID = { type: 'square', size: 70, offset_x: 0, offset_y: 0, snap: true, visible: true, color: '#fff', opacity: 0.25, distance: 1, unit: 'cell', measure: 'grid' }
const battlemap = (overrides = {}) => ({
  id: 'cave', name: 'Cave', rev: 1, image_url: '/api/observatory/images/1a2b3c4d-cave.png', grid: GRID, encounter: null,
  tokens: [
    { id: 't1', name: 'Orc', x: 1, y: 1, size: 1, hidden: false, combatant: null, show_bars: false, bars: [], color: null, image_url: null },
    { id: 't2', name: 'Dragon', x: 4, y: 4, size: 3, hidden: true, combatant: 'c1', show_bars: true, bars: ['HP'], color: null, image_url: null }
  ],
  ...overrides
})
const ENCOUNTER = {
  id: 'fight',
  combatants: [
    { id: 'c1', name: 'Dragon', type: 'adversary', sheet: 'n#dragon', resources: { HP: { current: 20, max: 30, min: 0 }, Fury: { current: 1, max: 3, min: 0 } } },
    { id: 'c2', name: 'Orc 2', type: 'adversary', sheet: 'n#orc', resources: {} },
    { id: 'c3', name: 'Aria', type: 'character', sheet: 'aria', image_url: '/api/observatory/images/1a2b3c4d-aria.png', resources: {} }
  ]
}

const mountEditor = (props = {}) => mount(BattlemapEditor, { props: { battlemapId: 'cave', canInteract: true, ...props } })
const canvas = (wrapper) => wrapper.findComponent({ name: 'BattlemapCanvas' })

beforeEach(() => {
  fake.reset(battlemap())
  Object.values(commands).forEach((command) => command.mockReset().mockResolvedValue({}))
  fetchAll.mockReset().mockResolvedValue([{ id: 'fight', name: 'Fight' }, { id: 'goblins/cave', name: 'Cave' }])
  post.mockReset().mockResolvedValue({})
  encounter.value = null
  vi.useRealTimers()
})

describe('BattlemapEditor', () => {
  it('gives the canvas the map, its grid and its tokens', () => {
    const wrapper = mountEditor()
    expect(canvas(wrapper).props('imageUrl')).toContain('cave.png')
    expect(canvas(wrapper).props('grid')).toEqual(GRID)
    expect(canvas(wrapper).props('tokens').map((t) => t.name)).toEqual(['Orc', 'Dragon'])
    expect(canvas(wrapper).props('editable')).toBe(true)
  })

  it('works out the counters a token shows from the encounter it stands in', () => {
    encounter.value = ENCOUNTER
    fake.doc.value.encounter = 'fight'
    const tokens = canvas(mountEditor()).props('tokens')
    expect(tokens[0].meters).toEqual([])
    expect(tokens[1].meters).toEqual([{ name: 'HP', current: 20, max: 30, min: 0, color: null, style: null }])
  })

  it('selects a token from the list and shows what can be changed about it', async () => {
    const wrapper = mountEditor()
    expect(wrapper.find('.inspector').exists()).toBe(false)
    await wrapper.findAll('.token-row')[0].trigger('click')
    expect(canvas(wrapper).props('selectedId')).toBe('t1')
    expect(wrapper.find('.inspector input').element.value).toBe('Orc')
    expect(wrapper.findAll('.token-row')[1].classes()).toContain('hidden')
  })

  it('changes a token: name, size, hidden, colour, image', async () => {
    const wrapper = mountEditor()
    await wrapper.findAll('.token-row')[0].trigger('click')
    const inspector = wrapper.find('.inspector')

    const name = inspector.find('input')
    name.element.value = ' Big Orc '
    await name.trigger('change')
    expect(commands.patchItem).toHaveBeenLastCalledWith('cave', 'tokens', 't1', { name: 'Big Orc' })

    const size = inspector.find('input[type="number"]')
    size.element.value = '99'
    await size.trigger('change')
    expect(commands.patchItem).toHaveBeenLastCalledWith('cave', 'tokens', 't1', { size: 20 })

    const hidden = inspector.find('input[type="checkbox"]')
    hidden.element.checked = true
    await hidden.trigger('change')
    expect(commands.patchItem).toHaveBeenLastCalledWith('cave', 'tokens', 't1', { hidden: true })

    await inspector.findAll('.swatch')[2].trigger('click')
    expect(commands.patchItem).toHaveBeenLastCalledWith('cave', 'tokens', 't1', { color: '#f472b6' })

    await inspector.findAll('.row')[1].find('button').trigger('click') // Choose image
    wrapper.findComponent({ name: 'ObservatoryModal' }).vm.$emit('select', { image_url: '/api/observatory/images/1a2b3c4d-orc.png' })
    expect(commands.patchItem).toHaveBeenLastCalledWith('cave', 'tokens', 't1', { image_url: '/api/observatory/images/1a2b3c4d-orc.png' })
  })

  it('removes a token after asking', async () => {
    const wrapper = mountEditor()
    await wrapper.findAll('.token-row')[0].trigger('click')
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await wrapper.find('.inspector .danger').trigger('click')
    expect(commands.removeItem).not.toHaveBeenCalled()
    confirm.mockReturnValue(true)
    await wrapper.find('.inspector .danger').trigger('click')
    expect(commands.removeItem).toHaveBeenCalledWith('cave', 'tokens', 't1')
  })

  it('adds a token on a free cell', async () => {
    const wrapper = mountEditor()
    await wrapper.find('.toolbar button[aria-label="Add a token"]').trigger('click')
    const [, , items] = commands.addItems.mock.calls[0]
    expect(items).toEqual([{ name: 'Token', x: 2, y: 1, size: 1 }]) // (1,1) is taken
  })

  it('attaches an encounter, and places the combatants that have no token yet', async () => {
    encounter.value = ENCOUNTER
    fake.doc.value.encounter = 'fight'
    const wrapper = mountEditor()
    await flushPromises()
    const select = wrapper.find('.panel select')
    expect([...select.element.options].map((o) => o.value)).toEqual(['', 'fight', 'goblins/cave'])
    select.element.value = 'goblins/cave'
    await select.trigger('change')
    expect(commands.patch).toHaveBeenLastCalledWith('cave', { encounter: 'goblins/cave' })
    select.element.value = ''
    await select.trigger('change')
    expect(commands.patch).toHaveBeenLastCalledWith('cave', { encounter: null })

    const place = wrapper.findAll('.panel > .tab-body > .rk-btn')[0]
    expect(place.text()).toBe('Place 2 combatants') // c1 already has a token
    await place.trigger('click')
    const [, collection, items] = commands.addItems.mock.calls[0]
    expect(collection).toBe('tokens')
    expect(items.map((i) => [i.name, i.combatant, i.x, i.y])).toEqual([['Orc 2', 'c2', 2, 1], ['Aria', 'c3', 3, 1]])
    expect(items[1]).toMatchObject({ sheet: 'aria', image_url: expect.stringContaining('aria.png'), color: '#34d399' })
  })

  it('links a token to a combatant and chooses which counters it shows', async () => {
    encounter.value = ENCOUNTER
    fake.doc.value.encounter = 'fight'
    const wrapper = mountEditor()
    await wrapper.findAll('.token-row')[1].trigger('click')
    const inspector = wrapper.find('.inspector')
    expect(inspector.text()).toContain('HP')
    expect(inspector.text()).toContain('Fury')

    const fury = inspector.findAll('.check.indent input')[1]
    fury.element.checked = true
    await fury.trigger('change')
    expect(commands.patchItem).toHaveBeenLastCalledWith('cave', 'tokens', 't2', { bars: ['HP', 'Fury'] })
    const hp = inspector.findAll('.check.indent input')[0]
    hp.element.checked = false
    await hp.trigger('change')
    expect(commands.patchItem).toHaveBeenLastCalledWith('cave', 'tokens', 't2', { bars: [] })

    const link = inspector.find('select')
    link.element.value = 'c2'
    await link.trigger('change')
    expect(commands.patchItem).toHaveBeenLastCalledWith('cave', 'tokens', 't2', { combatant: 'c2', sheet: 'n#orc', bars: [], show_bars: false })
  })

  it('changes the grid one setting at a time', async () => {
    const wrapper = mountEditor()
    await wrapper.findAll('.tab')[1].trigger('click')
    const field = (label) => wrapper.findAll('.field').find((f) => f.text().startsWith(label)).find('input, select')

    const size = field('Cell size')
    size.element.value = '100'
    await size.trigger('change')
    expect(commands.patch).toHaveBeenLastCalledWith('cave', { grid: { size: 100 } })

    const unit = field('Unit')
    unit.element.value = ' ft '
    await unit.trigger('change')
    expect(commands.patch).toHaveBeenLastCalledWith('cave', { grid: { unit: 'ft' } })

    const distance = field('One cell is')
    distance.element.value = '-3'
    await distance.trigger('change')
    expect(commands.patch).toHaveBeenLastCalledWith('cave', { grid: { distance: 1 } }) // not positive: keeps what it was

    const measure = field('The ruler counts')
    measure.element.value = 'straight'
    await measure.trigger('change')
    expect(commands.patch).toHaveBeenLastCalledWith('cave', { grid: { measure: 'straight' } })

    const snap = wrapper.find('.grid-fields input[type="checkbox"]')
    snap.element.checked = false
    await snap.trigger('change')
    expect(commands.patch).toHaveBeenLastCalledWith('cave', { grid: { snap: false } })
  })

  it('shows the map on the screen, and stops', async () => {
    const wrapper = mountEditor()
    const button = wrapper.find('.toolbar button[aria-label="Show on the screen"]')
    await button.trigger('click')
    await flushPromises()
    expect(post).toHaveBeenLastCalledWith('/api/screen/battlemap', { battlemap_id: 'cave' })
    const stop = wrapper.find('.toolbar button[aria-label="Stop showing on the screen"]')
    expect(stop.exists()).toBe(true)
    await stop.trigger('click')
    await flushPromises()
    expect(post).toHaveBeenLastCalledWith('/api/screen/clear', {})
  })

  describe('moving tokens', () => {
    it('sends where a dragged token is at most every 80 ms, and where it is dropped at once', async () => {
      vi.useFakeTimers()
      const wrapper = mountEditor()
      canvas(wrapper).vm.$emit('moving', 't1', { x: 2, y: 1 })
      canvas(wrapper).vm.$emit('moving', 't1', { x: 3, y: 1 })
      canvas(wrapper).vm.$emit('moving', 't1', { x: 4, y: 1 })
      expect(commands.patchItem).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(80)
      expect(commands.patchItem).toHaveBeenCalledTimes(1)
      expect(commands.patchItem).toHaveBeenLastCalledWith('cave', 'tokens', 't1', { x: 4, y: 1 }) // the latest
      canvas(wrapper).vm.$emit('moving', 't1', { x: 5, y: 1 })
      canvas(wrapper).vm.$emit('move', 't1', { x: 6, y: 2 })
      await vi.advanceTimersByTimeAsync(500)
      expect(commands.patchItem).toHaveBeenCalledTimes(2)
      expect(commands.patchItem).toHaveBeenLastCalledWith('cave', 'tokens', 't1', { x: 6, y: 2 }) // the pending one was dropped
    })

    it('sends one move at a time, so an older one cannot land after the drop', async () => {
      const inFlight = []
      let release
      commands.patchItem.mockImplementation(() => {
        inFlight.push(true)
        return new Promise((resolve) => { release = () => { inFlight.pop(); resolve({}) } })
      })
      const wrapper = mountEditor()
      canvas(wrapper).vm.$emit('move', 't1', { x: 2, y: 1 })       // the first is on its way...
      canvas(wrapper).vm.$emit('move', 't1', { x: 3, y: 1 })
      canvas(wrapper).vm.$emit('move', 't1', { x: 4, y: 1 })       // ...and only the newest of these waits
      canvas(wrapper).vm.$emit('move', 't2', { x: 9, y: 9 })       // another token's move is not lost
      expect(commands.patchItem).toHaveBeenCalledTimes(1)
      expect(inFlight).toHaveLength(1)

      for (let sent = 1; sent < 3; sent++) {
        release()
        await flushPromises()
        expect(commands.patchItem).toHaveBeenCalledTimes(sent + 1)
        expect(inFlight).toHaveLength(1)                              // never two at once
      }
      release()
      await flushPromises()
      expect(commands.patchItem.mock.calls.map(([, , token, at]) => [token, at.x])).toEqual([
        ['t1', 2], ['t1', 4], ['t2', 9]
      ])
    })

    it('keeps sending after a move the server refused', async () => {
      commands.patchItem.mockRejectedValueOnce({ response: { data: { detail: 'No such token' } } })
      const wrapper = mountEditor()
      canvas(wrapper).vm.$emit('move', 't1', { x: 2, y: 1 })
      canvas(wrapper).vm.$emit('move', 't2', { x: 3, y: 3 })
      await flushPromises()
      expect(commands.patchItem).toHaveBeenCalledTimes(2)   // the refusal did not stop the queue
      expect(wrapper.find('.rk-alert').exists()).toBe(false) // (and the move after it went through)
    })
  })

  it('can be looked at, not changed, by someone signed out', () => {
    const wrapper = mountEditor({ canInteract: false })
    expect(canvas(wrapper).props('editable')).toBe(false)
    expect(wrapper.find('.toolbar button[aria-label="Add a token"]').exists()).toBe(false)
    expect(wrapper.find('.toolbar button[aria-label="Show on the screen"]').exists()).toBe(false)
    expect(fetchAll).not.toHaveBeenCalled()
  })

  it('has its own words for loading, a missing map and a failure', () => {
    fake.status.value = 'loading'
    expect(mountEditor().text()).toContain('Loading map')
    fake.status.value = 'gone'
    expect(mountEditor().text()).toContain('moved or deleted')
    fake.status.value = 'error'
    fake.error.value = 'boom'
    expect(mountEditor().text()).toContain('boom')
  })

  it('shows what the server refused', async () => {
    commands.patch.mockRejectedValue({ response: { data: { detail: 'Images must be assets from the asset library' } } })
    const wrapper = mountEditor()
    await wrapper.findAll('.tab')[1].trigger('click')
    const snap = wrapper.find('.grid-fields input[type="checkbox"]')
    await snap.trigger('change')
    await flushPromises()
    expect(wrapper.find('.rk-alert').text()).toContain('asset library')
  })
})
