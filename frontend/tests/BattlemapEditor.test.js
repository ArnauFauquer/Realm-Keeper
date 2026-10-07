// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import * as fake from './helpers/fakeSyncedDoc'

const { commands, encounterCommands, createEncounter, encounterCommit, fetchAll, fetchSheet, post, encounter, signals } = vi.hoisted(() => ({
  commands: { patch: vi.fn(), patchItem: vi.fn(), addItems: vi.fn(), removeItem: vi.fn(), editList: vi.fn() },
  encounterCommands: { adjust: vi.fn(), patchItem: vi.fn(), editList: vi.fn(), addItems: vi.fn() },
  createEncounter: vi.fn(),
  encounterCommit: vi.fn((command) => Promise.resolve(command)),
  fetchAll: vi.fn(),
  fetchSheet: vi.fn(),
  post: vi.fn(),
  encounter: { value: null },
  signals: { layer: { kind: 'layer' }, ping: vi.fn(), point: vi.fn(), release: vi.fn(), roll: vi.fn(), measure: vi.fn() }
}))

vi.mock('@/composables/useSyncedDoc', async () => {
  const helper = await import('./helpers/fakeSyncedDoc')
  const { computed } = await import('vue')
  return {
    useSyncedDoc: () => ({ doc: helper.doc, status: helper.status, error: helper.error, commit: helper.commit }),
    useSyncedDocFollowing: () => ({ doc: computed(() => encounter.value), status: ref('ready'), commit: encounterCommit })
  }
})
vi.mock('@/composables/useCharacters', async () => {
  const helper = await import('./helpers/fakeSyncedDoc')
  return { useCharacters: () => ({ ...helper.characters, docs: ref({}) }) }
})
vi.mock('@/composables/syncSocket', () => ({ syncStatus: ref('open'), listenToSync: () => () => {} }))
vi.mock('@/composables/useMapSignals', () => ({ useMapSignals: () => signals }))
vi.mock('@/api/docs', () => ({ battlemapsApi: { commands }, encountersApi: { fetchAll, fetch: vi.fn(), create: createEncounter, commands: encounterCommands } }))
vi.mock('@/api/sheets', () => ({ fetchSheet }))
vi.mock('@/api/http', async (importOriginal) => ({ ...(await importOriginal()), post }))
vi.mock('@/config/env', () => ({ apiUrl: '' }))
// The canvas has its own tests; here it only has to pass things on.
vi.mock('@/components/BattlemapCanvas.vue', () => ({
  default: {
    name: 'BattlemapCanvas',
    props: ['imageUrl', 'grid', 'tokens', 'areas', 'selectedId', 'selectedAreaId', 'tool', 'areaShape', 'editable', 'signals'],
    emits: ['select', 'move', 'open', 'ping', 'point', 'release', 'measure', 'select-area', 'move-area', 'add-area'],
    template: '<div class="canvas"><slot name="empty" /></div>'
  }
}))
// So is the sheet picker (an encounter's own) and the sheet a combatant is
// played from (tests/CombatantPlay.test.js).
vi.mock('@/components/EncounterAddPanel.vue', () => ({
  default: { name: 'EncounterAddPanel', props: ['presentCharacters'], emits: ['add', 'add-custom'], template: '<div class="add-panel" />' }
}))
vi.mock('@/components/CombatantPlay.vue', () => ({
  default: {
    name: 'CombatantPlay',
    props: ['combatant', 'counters', 'sheetState', 'canInteract'],
    emits: ['adjust', 'patch', 'add-condition', 'remove-condition', 'rolled', 'edit-sheet'],
    template: '<div class="play">{{ combatant.name }}</div>'
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
const play = (wrapper) => wrapper.findComponent({ name: 'CombatantPlay' })
const openTab = (wrapper, label) => wrapper.findAll('.tab').find((t) => t.text() === label).trigger('click')

beforeEach(() => {
  fake.reset(battlemap())
  Object.values(commands).forEach((command) => command.mockReset().mockResolvedValue({}))
  Object.values(encounterCommands).forEach((command) => command.mockReset().mockResolvedValue({}))
  Object.values(signals).forEach((fn) => typeof fn === 'function' && fn.mockReset())
  encounterCommit.mockClear()
  fetchSheet.mockReset().mockResolvedValue({ sheet: { name: 'Dragon', resources: {}, sections: [] } })
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
    await openTab(wrapper, 'Tokens') // (it opens on the sheets of its encounter)
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
    await openTab(wrapper, 'Tokens')
    await wrapper.findAll('.token-row')[1].trigger('click')
    const inspector = wrapper.find('.inspector')
    expect(inspector.text()).toContain('HP')
    expect(inspector.text()).toContain('Fury')

    const fury = inspector.findAll('.check.indent input')[1]
    fury.element.checked = true
    await fury.trigger('change')
    expect(commands.editList).toHaveBeenLastCalledWith('cave', 'tokens', 't2', 'bars', { add: ['Fury'] })
    const hp = inspector.findAll('.check.indent input')[0]
    hp.element.checked = false
    await hp.trigger('change')
    expect(commands.editList).toHaveBeenLastCalledWith('cave', 'tokens', 't2', 'bars', { remove: ['HP'] })

    const link = inspector.find('select')
    link.element.value = 'c2'
    await link.trigger('change')
    expect(commands.patchItem).toHaveBeenLastCalledWith('cave', 'tokens', 't2', { combatant: 'c2', sheet: 'n#orc', bars: [], show_bars: false })
  })

  it('changes the grid one setting at a time', async () => {
    const wrapper = mountEditor()
    await openTab(wrapper, 'Map')
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
    it('moves a token where it is dropped, and shares the path it is dragged along', async () => {
      const wrapper = mountEditor()
      const path = { points: [{ x: 1.5, y: 1.5 }, { x: 4.5, y: 1.5 }], token: 't1', end: false }
      canvas(wrapper).vm.$emit('measure', path)
      expect(signals.measure).toHaveBeenCalledWith(path)
      expect(commands.patchItem).not.toHaveBeenCalled() // nothing moves while it is dragged
      canvas(wrapper).vm.$emit('move', 't1', { x: 4, y: 1 })
      await flushPromises()
      expect(commands.patchItem).toHaveBeenCalledWith('cave', 'tokens', 't1', { x: 4, y: 1 })
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
    await openTab(wrapper, 'Map')
    const snap = wrapper.find('.grid-fields input[type="checkbox"]')
    await snap.trigger('change')
    await flushPromises()
    expect(wrapper.find('.rk-alert').text()).toContain('asset library')
  })

  describe('playing sheets from the map', () => {
    const withEncounter = () => {
      encounter.value = ENCOUNTER
      fake.doc.value.encounter = 'fight'
      return mountEditor()
    }

    it('opens on the sheets of its encounter, everyone in it on the roster', () => {
      const wrapper = withEncounter()
      expect(wrapper.find('.tab.active').text()).toBe('Sheet')
      const chips = wrapper.findAll('.roster-chip')
      expect(chips.map((c) => c.text())).toEqual(['Dragon', 'Orc 2', 'Aria'])
      expect(chips.map((c) => c.classes().includes('unplaced'))).toEqual([false, true, true]) // only c1 has a token
      expect(play(wrapper).exists()).toBe(false) // nobody picked yet
    })

    it('without an encounter, says how to get one and attaches it from there', async () => {
      const wrapper = mountEditor()
      await openTab(wrapper, 'Sheet')
      await flushPromises()
      expect(wrapper.find('.sheet-empty').exists()).toBe(true)
      const select = wrapper.find('.sheet-empty select')
      select.element.value = 'fight'
      await select.trigger('change')
      expect(commands.patch).toHaveBeenLastCalledWith('cave', { encounter: 'fight' })
    })

    it('plays whoever the selected token stands for, and selects the token of whoever is picked', async () => {
      const wrapper = withEncounter()
      canvas(wrapper).vm.$emit('select', 't2')
      await flushPromises()
      expect(play(wrapper).props('combatant').id).toBe('c1')
      expect(play(wrapper).props('counters').map((r) => r.name)).toEqual(['HP', 'Fury'])
      expect(fetchSheet).toHaveBeenCalledWith('adversary', 'n#dragon')
      expect(play(wrapper).props('sheetState')).toMatchObject({ status: 'ready' })

      await wrapper.findAll('.roster-chip')[1].trigger('click') // Orc 2: not on the map
      expect(play(wrapper).props('combatant').id).toBe('c2')
      expect(canvas(wrapper).props('selectedId')).toBe('t2') // no token of its own to select
      await wrapper.findAll('.roster-chip')[0].trigger('click')
      expect(canvas(wrapper).props('selectedId')).toBe('t2')
    })

    it('changes the combatant through its encounter, the same commands as the tracker', async () => {
      const wrapper = withEncounter()
      canvas(wrapper).vm.$emit('select', 't2')
      await flushPromises()
      play(wrapper).vm.$emit('adjust', 'HP', -1)
      expect(encounterCommands.adjust).toHaveBeenLastCalledWith('fight', 'combatants', 'c1', 'HP', -1)
      play(wrapper).vm.$emit('patch', { defeated: true })
      expect(encounterCommands.patchItem).toHaveBeenLastCalledWith('fight', 'combatants', 'c1', { defeated: true })
      play(wrapper).vm.$emit('add-condition', 'Prone')
      expect(encounterCommands.editList).toHaveBeenLastCalledWith('fight', 'combatants', 'c1', 'conditions', { add: [expect.objectContaining({ name: 'Prone' })] })
      play(wrapper).vm.$emit('remove-condition', { id: 'x1', name: 'Prone' })
      expect(encounterCommands.editList).toHaveBeenLastCalledWith('fight', 'combatants', 'c1', 'conditions', { remove: ['x1'] })
      await flushPromises()
      expect(encounterCommit).toHaveBeenCalledTimes(4) // each event applied to the encounter as it returns
      expect(commands.patchItem).not.toHaveBeenCalled() // and nothing sent to the map
    })

    it("a character's counters are its own", async () => {
      const wrapper = withEncounter()
      await wrapper.findAll('.roster-chip')[2].trigger('click')
      play(wrapper).vm.$emit('adjust', 'Hope', 1)
      expect(fake.characters.adjust).toHaveBeenLastCalledWith('aria', 'Hope', 1)
      expect(encounterCommands.adjust).not.toHaveBeenCalled()
    })

    it('shows a roll over the token of whoever rolled, if they have one', async () => {
      const wrapper = withEncounter()
      canvas(wrapper).vm.$emit('select', 't2')
      await flushPromises()
      const roll = { label: 'Bite', formula: '2d6+3', total: 11 }
      play(wrapper).vm.$emit('rolled', { ...roll, combatant: 'c1' })
      expect(signals.roll).toHaveBeenCalledWith('t2', roll)

      // The dice may land after someone else was picked: the roll is still the roller's.
      await wrapper.findAll('.roster-chip')[1].trigger('click')
      play(wrapper).vm.$emit('rolled', { ...roll, combatant: 'c1' })
      expect(signals.roll).toHaveBeenLastCalledWith('t2', roll)
      play(wrapper).vm.$emit('rolled', { ...roll, combatant: 'c2' }) // not on the map
      expect(signals.roll).toHaveBeenCalledTimes(2)
    })

    it('a token double-clicked shows its sheet, or the token itself when it stands for no one', async () => {
      const wrapper = withEncounter()
      await openTab(wrapper, 'Map')
      canvas(wrapper).vm.$emit('open', 't2')
      await flushPromises()
      expect(wrapper.find('.tab.active').text()).toBe('Sheet')
      expect(play(wrapper).props('combatant').id).toBe('c1')

      canvas(wrapper).vm.$emit('open', 't1')
      await flushPromises()
      expect(wrapper.find('.tab.active').text()).toBe('Tokens')
      expect(wrapper.find('.inspector input').element.value).toBe('Orc')
    })

    it("opens the sheet's own editor", async () => {
      const { useDocModal } = await import('@/composables/useDocModal')
      const wrapper = withEncounter()
      canvas(wrapper).vm.$emit('select', 't2')
      await flushPromises()
      play(wrapper).vm.$emit('edit-sheet')
      expect(useDocModal('adversary').isOpen.value).toBe(true)
      expect(useDocModal('adversary').targetId.value).toBe('n#dragon')
    })
  })

  describe('pointing', () => {
    it('hands the canvas the signals, and passes on what it points at', () => {
      const wrapper = mountEditor()
      expect(canvas(wrapper).props('signals')).toBe(signals.layer)
      canvas(wrapper).vm.$emit('ping', { x: 1, y: 2 })
      canvas(wrapper).vm.$emit('point', { x: 3, y: 4 })
      canvas(wrapper).vm.$emit('release')
      expect(signals.ping).toHaveBeenCalledWith({ x: 1, y: 2 })
      expect(signals.point).toHaveBeenCalledWith({ x: 3, y: 4 })
      expect(signals.release).toHaveBeenCalled()
    })

    it('picks the tools by their keys, and not while typing', async () => {
      const wrapper = mountEditor({}, { attachTo: document.body })
      const press = async (key, target = window) => {
        target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
        await flushPromises()
      }
      await press('p')
      expect(canvas(wrapper).props('tool')).toBe('pointer')
      await press('r')
      expect(canvas(wrapper).props('tool')).toBe('ruler')
      await press('v', wrapper.find('.inspector-head input').exists() ? wrapper.find('.inspector-head input').element : wrapper.find('select').element)
      expect(canvas(wrapper).props('tool')).toBe('ruler')
      await press('V')
      expect(canvas(wrapper).props('tool')).toBe('select')
      wrapper.unmount()
    })

    it('has no pointer for someone signed out: everyone would see it', () => {
      const wrapper = mountEditor({ canInteract: false })
      const tools = wrapper.findAll('.tool-group button').map((b) => b.attributes('aria-label'))
      expect(tools).toEqual(['Select and move', 'Measure: Space adds a turn']) // no pointer, no areas
    })
  })

  describe('areas', () => {
    const AREA = { id: 'a1', shape: 'circle', x: 2, y: 2, size: 2, angle: 0, spread: 60, width: 1, color: '#f97316', label: '', hidden: false }

    it('adds one drawn on the map, in the first area colour, and selects it', async () => {
      commands.addItems.mockResolvedValue({ upsert: { areas: [{ ...AREA, id: 'new' }] } })
      const wrapper = mountEditor()
      canvas(wrapper).vm.$emit('add-area', { shape: 'cone', x: 2, y: 2, size: 4, angle: 90 })
      await flushPromises()
      expect(commands.addItems).toHaveBeenCalledWith('cave', 'areas', [{ shape: 'cone', x: 2, y: 2, size: 4, angle: 90, color: '#f97316' }])
      expect(canvas(wrapper).props('selectedAreaId')).toBe('new')
    })

    it('lists them, and changes, moves and removes the selected one', async () => {
      fake.doc.value.areas = [AREA]
      const wrapper = mountEditor()
      await openTab(wrapper, 'Tokens')
      expect(wrapper.find('.area-size').text()).toBe('2 cell') // its reach, as the map counts it
      canvas(wrapper).vm.$emit('select-area', 'a1')
      await flushPromises()
      const inspector = wrapper.findComponent({ name: 'AreaInspector' })
      inspector.vm.$emit('patch', { shape: 'line' })
      expect(commands.patchItem).toHaveBeenLastCalledWith('cave', 'areas', 'a1', { shape: 'line' })
      canvas(wrapper).vm.$emit('move-area', 'a1', { x: 5, y: 5.5 })
      expect(commands.patchItem).toHaveBeenLastCalledWith('cave', 'areas', 'a1', { x: 5, y: 5.5 })
      inspector.vm.$emit('remove')
      expect(commands.removeItem).toHaveBeenCalledWith('cave', 'areas', 'a1')
    })

    it('selects a token or an area, never both', async () => {
      fake.doc.value.areas = [AREA]
      const wrapper = mountEditor()
      canvas(wrapper).vm.$emit('select', 't1')
      canvas(wrapper).vm.$emit('select-area', 'a1')
      await flushPromises()
      expect(canvas(wrapper).props('selectedId')).toBeNull()
      canvas(wrapper).vm.$emit('select', 't1')
      await flushPromises()
      expect(canvas(wrapper).props('selectedAreaId')).toBeNull()
    })

    it('draws with the shape picked under the toolbar', async () => {
      const wrapper = mountEditor()
      await wrapper.find('.toolbar button[aria-label="Draw an area"]').trigger('click')
      await wrapper.find('button[aria-label="Line"]').trigger('click')
      expect(canvas(wrapper).props('tool')).toBe('area')
      expect(canvas(wrapper).props('areaShape')).toBe('line')
    })
  })

  describe('setting the map up', () => {
    it('frames a token\'s image', async () => {
      fake.doc.value.tokens[0].image_url = '/api/observatory/images/1a2b3c4d-orc.png'
      const wrapper = mountEditor()
      await wrapper.findAll('.token-row')[0].trigger('click')
      wrapper.findComponent({ name: 'TokenImageEditor' }).vm.$emit('change', { image_scale: 1.5, image_x: 0.1 })
      expect(commands.patchItem).toHaveBeenLastCalledWith('cave', 'tokens', 't1', { image_scale: 1.5, image_x: 0.1 })
    })

    it('measures in range bands of its own', async () => {
      fake.doc.value.grid = { ...GRID, measure: 'bands', bands: [] }
      const wrapper = mountEditor()
      await openTab(wrapper, 'Map')
      const bands = [{ name: 'Near', max: 2 }, { name: 'Far', max: null }]
      wrapper.findComponent({ name: 'RangeBandsEditor' }).vm.$emit('change', bands)
      expect(commands.patch).toHaveBeenLastCalledWith('cave', { grid: { bands } })
    })
  })

  describe('adding to the fight from the map', () => {
    it('adds from sheets to the encounter, and puts the new ones on the map', async () => {
      encounter.value = ENCOUNTER
      fake.doc.value.encounter = 'fight'
      encounterCommit.mockImplementation(async (command) => command)
      encounterCommands.addItems.mockResolvedValue({ upsert: { combatants: [{ id: 'n1', name: 'Bugboar', type: 'adversary', sheet: 'bugboar', resources: {} }] } })
      const wrapper = mountEditor()
      await wrapper.find('.sheet-actions button').trigger('click')
      const sheet = { ref: 'bugboar', name: 'Bugboar', type: 'adversary', resources: { HP: { max: 6 } } }
      wrapper.findComponent({ name: 'EncounterAddPanel' }).vm.$emit('add', sheet, 1)
      await flushPromises()
      const [encounterId, collection, items] = encounterCommands.addItems.mock.calls[0]
      expect([encounterId, collection, items[0].name, items[0].resources.HP.current]).toEqual(['fight', 'combatants', 'Bugboar', 6])
      const [, tokens, placed] = commands.addItems.mock.calls[0]
      expect(tokens).toBe('tokens')
      expect(placed).toEqual([expect.objectContaining({ name: 'Bugboar', combatant: 'n1', sheet: 'bugboar', x: 2, y: 1 })])
    })

    it('gives a map without one an encounter of its own, next to it', async () => {
      createEncounter.mockResolvedValue({ id: 'cave-2', name: 'Cave' })
      const wrapper = mountEditor()
      await openTab(wrapper, 'Sheet')
      await wrapper.find('.sheet-empty .rk-btn').trigger('click')
      await flushPromises()
      expect(createEncounter).toHaveBeenCalledWith('Cave', null, '')
      expect(commands.patch).toHaveBeenLastCalledWith('cave', { encounter: 'cave-2' })
    })
  })
})
