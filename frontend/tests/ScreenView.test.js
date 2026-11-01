// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'

// The socket is useScreenSocket's business (tests/useScreenSocket.test.js):
// here a test hands messages straight to the view.
let socket
vi.mock('@/composables/useScreenSocket', () => ({
  useScreenSocket: (handlers) => {
    socket = { ...handlers, notPaired: ref(false), pairError: ref(''), start: vi.fn() }
    return socket
  }
}))
vi.mock('vue-router', () => ({ useRoute: () => ({ query: {} }), useRouter: () => ({ go: vi.fn(), push: vi.fn() }) }))
vi.mock('@/composables/useConstellationGraph', () => ({ drawStarfield: vi.fn() }))

// Each fetch waits until the test settles it, so a test picks the order.
const fetches = []
function deferredFetch(kind) {
  return (id) => new Promise((resolve, reject) => fetches.push({ kind, id, resolve, reject }))
}
vi.mock('@/api/docs', () => ({
  chartsApi: { fetch: (id) => deferredFetch('chart')(id) },
  vistasApi: { fetch: (id) => deferredFetch('vista')(id) }
}))

const world = {
  clearDice: vi.fn(),
  render: vi.fn(),
  resize: vi.fn(),
  dispose: vi.fn()
}
const createDiceWorld = vi.fn(() => world)
const replayGroups = vi.fn(() => Promise.resolve())
vi.mock('@/dice/diceWorld', () => ({ createDiceWorld: (...args) => createDiceWorld(...args) }))
vi.mock('@/dice/diceRoller', () => ({ replayGroups: (...args) => replayGroups(...args) }))

const ScreenView = (await import('@/views/ScreenView.vue')).default

const stubs = {
  ChartCanvas: { props: ['chart'], template: '<div class="chart">{{ chart.id }}:{{ chart.name }}</div>' },
  VistaCanvas: { props: ['vista'], template: '<div class="vista">{{ vista.id }}</div>' },
  BattlemapScreen: { name: 'BattlemapScreen', props: ['state', 'signals'], template: '<div class="battlemap">{{ state.battlemap_id }}</div>' },
  ConstellationScreen: { props: ['state'], template: '<div class="constellation"></div>' }
}

let wrapper

async function send(message) {
  socket.onMessage(message)
  await flushPromises()
}

function settle(kind, id, doc) {
  const fetch = fetches.find(f => f.kind === kind && f.id === id)
  fetch.resolve(doc ?? { id })
  return flushPromises()
}

beforeEach(async () => {
  fetches.length = 0
  vi.clearAllMocks()
  wrapper = mount(ScreenView, { global: { stubs } })
  await flushPromises()
})

afterEach(() => wrapper.unmount())

describe('ScreenView scenes', () => {
  it('connects once mounted', () => {
    expect(socket.start).toHaveBeenCalled()
  })

  it('shows the latest chart when an earlier one loads last', async () => {
    await send({ type: 'display_chart', chart_id: 'a' })
    await send({ type: 'display_chart', chart_id: 'b' })
    await settle('chart', 'b', { id: 'b', name: 'B' })
    await settle('chart', 'a', { id: 'a', name: 'A' })
    expect(wrapper.find('.chart').text()).toBe('b:B')
  })

  it('a chart that loads late does not cover the image sent after it', async () => {
    await send({ type: 'display_chart', chart_id: 'a' })
    await send({ type: 'display_media', url: '/api/img/map.png', title: 'Map' })
    await settle('chart', 'a')
    expect(wrapper.find('.chart').exists()).toBe(false)
    expect(wrapper.find('img.screen-image-fill').attributes('src')).toBe('/api/img/map.png')
  })

  it('drops the image caption when a chart is sent', async () => {
    await send({ type: 'display_media', url: '/api/img/map.png', title: 'Harbour' })
    expect(wrapper.find('.screen-caption').exists()).toBe(true)
    await send({ type: 'display_chart', chart_id: 'a' })
    await settle('chart', 'a')
    expect(wrapper.find('.screen-caption').exists()).toBe(false)
    expect(wrapper.find('.chart').exists()).toBe(true)
  })

  it('applies live edits to the chart on screen, and ones that beat the fetch', async () => {
    await send({ type: 'display_chart', chart_id: 'a' })
    await send({ type: 'update_chart', chart_id: 'a', name: 'Draft' })
    await settle('chart', 'a', { id: 'a', name: 'Saved' })
    expect(wrapper.find('.chart').text()).toBe('a:Draft')
    await send({ type: 'update_chart', chart_id: 'a', name: 'Draft 2' })
    expect(wrapper.find('.chart').text()).toBe('a:Draft 2')
  })

  it('shows a battlemap once its projection arrives and clears it on clear_screen', async () => {
    await send({ type: 'display_battlemap', battlemap_id: 'cave' })
    await send({ type: 'update_battlemap', battlemap_id: 'cave', tokens: [], grid: {} })
    expect(wrapper.find('.battlemap').text()).toBe('cave')
    await send({ type: 'clear_screen' })
    expect(wrapper.find('.battlemap').exists()).toBe(false)
  })

  it('hands the battlemap the pings sent for it, and leaves the scene as it is', async () => {
    await send({ type: 'display_battlemap', battlemap_id: 'cave' })
    await send({ type: 'update_battlemap', battlemap_id: 'cave', tokens: [], grid: {} })
    const layer = wrapper.findComponent({ name: 'BattlemapScreen' }).props('signals')
    const ping = (battlemap_id) => ({ type: 'battlemap_signal', battlemap_id, kind: 'ping', points: [{ x: 1, y: 2 }], by: 'Leo' })
    await send(ping('other-cave'))
    expect(layer.idle()).toBe(true)
    await send(ping('cave'))
    expect(layer.view().pings).toMatchObject([{ x: 1, y: 2, by: 'Leo' }])
    expect(wrapper.find('.battlemap').text()).toBe('cave')

    await send({ type: 'display_media', url: '/api/img/map.png' })
    expect(layer.idle()).toBe(true) // a new scene: the old one's pings go with it
  })
})

describe('ScreenView dice', () => {
  const roll = (total) => ({ type: 'dice_roll', formula: '1d20', groups: [{ sides: 20, sign: 1, rolls: [total] }], total })

  it('shows the roll over the scene and keeps one dice world for every roll', async () => {
    await send({ type: 'display_media', url: '/api/img/map.png' })
    await send(roll(12))
    expect(wrapper.find('.dice-total').text()).toBe('12')
    // The 3D code is loaded on the first roll.
    await vi.waitFor(() => expect(replayGroups).toHaveBeenCalledTimes(1))
    await send(roll(7))
    expect(wrapper.find('.dice-total').text()).toBe('7')
    expect(createDiceWorld).toHaveBeenCalledTimes(1)
    expect(replayGroups).toHaveBeenCalledTimes(2)
    // The first roll's tumble was told to stop, and its dice cleared.
    expect(replayGroups.mock.calls[0][3].signal.aborted).toBe(true)
    expect(replayGroups.mock.calls[1][3].signal.aborted).toBe(false)
    expect(world.clearDice).toHaveBeenCalled()
    // The image underneath is untouched.
    expect(wrapper.find('img.screen-image-fill').exists()).toBe(true)
  })

  it('a new scene takes the roll down', async () => {
    await send(roll(12))
    await vi.waitFor(() => expect(replayGroups).toHaveBeenCalledTimes(1))
    await send({ type: 'clear_screen' })
    expect(wrapper.find('.dice-total').exists()).toBe(false)
    expect(replayGroups.mock.calls[0][3].signal.aborted).toBe(true)
  })

  it('still shows the roll on a screen without WebGL', async () => {
    createDiceWorld.mockImplementationOnce(() => { throw new Error('no WebGL') })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await send(roll(4))
    await vi.waitFor(() => expect(createDiceWorld).toHaveBeenCalledTimes(1))
    await send(roll(5))
    expect(wrapper.find('.dice-total').text()).toBe('5')
    expect(createDiceWorld).toHaveBeenCalledTimes(1)
    expect(replayGroups).not.toHaveBeenCalled()
  })

  it('frees the dice world when the screen goes away', async () => {
    await send(roll(3))
    wrapper.unmount()
    expect(world.dispose).toHaveBeenCalled()
    wrapper = mount(ScreenView, { global: { stubs } })
  })
})
