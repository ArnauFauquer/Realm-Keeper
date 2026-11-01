// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, reactive } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'

const m = vi.hoisted(() => ({ route: null, auth: null, update: null, opened: null }))
vi.mock('@/composables/useAuth', async () => {
  const { ref } = await import('vue')
  m.auth = {
    user: ref(null), checked: ref(true), choosingProvider: ref(false),
    checkAuth: vi.fn(), login: vi.fn()
  }
  return { useAuth: () => m.auth }
})
vi.mock('@/composables/useAppUpdate', async () => {
  const { ref } = await import('vue')
  m.update = { stale: ref(false), reload: vi.fn() }
  return { useAppUpdate: () => m.update, watchForUpdates: vi.fn() }
})
// Heavy children: App's own wiring is what is under test.
const stub = (name, extra = {}) => ({ default: defineComponent({ name, ...extra, render() { return h('div', { class: `stub-${name}` }) } }) })
vi.mock('@/components/NotesSidebar.vue', () => stub('NotesSidebar', { methods: { openSearchWithTag(tag) { m.opened = tag } } }))
vi.mock('@/components/NebulaBackground.vue', () => stub('NebulaBackground'))
vi.mock('@/components/DiceFab.vue', () => stub('DiceFab'))
vi.mock('@/components/DicePanel.vue', () => stub('DicePanel'))
vi.mock('@/components/DiceOverlay.vue', () => stub('DiceOverlay'))
vi.mock('@/components/DiceToastStack.vue', () => stub('DiceToastStack'))
vi.mock('@/components/LoginGate.vue', () => stub('LoginGate', { props: ['error', 'dismissible'], emits: ['login', 'close'] }))

const App = (await import('@/App.vue')).default

const mounted = []
function make(meta = { public: true }) {
  m.route = reactive({ meta })
  const wrapper = mount(App, {
    global: {
      mocks: { $route: m.route },
      stubs: { 'router-view': true }
    }
  })
  mounted.push(wrapper)
  return wrapper
}

afterEach(() => { mounted.splice(0).forEach((w) => w.unmount()) })

beforeEach(() => {
  m.auth.user.value = null
  m.auth.checked.value = true
  m.auth.choosingProvider.value = false
  m.auth.checkAuth.mockReset()
  m.auth.login.mockReset()
  m.update.stale.value = false
  m.update.reload.mockReset()
  m.opened = null
  sessionStorage.clear()
  window.history.replaceState(null, '', '/')
})

describe('App', () => {
  it('checks the session on start, and shows a public page without signing in', () => {
    const w = make()
    expect(m.auth.checkAuth).toHaveBeenCalled()
    expect(w.find('.stub-LoginGate').exists()).toBe(false)
    expect(w.find('.stub-NotesSidebar').exists()).toBe(true)
    expect(w.find('.stub-NebulaBackground').exists()).toBe(true)
    expect(w.find('.stub-DiceOverlay').exists()).toBe(true)
  })

  it('waits with a spinner on a private page until the session is checked', () => {
    m.auth.checked.value = false
    const w = make({})
    expect(w.find('.auth-loading').exists()).toBe(true)
    expect(w.find('.stub-NotesSidebar').exists()).toBe(false)
  })

  it('sends someone who is not signed in to the login gate on a private page', () => {
    const w = make({})
    expect(w.find('.stub-LoginGate').exists()).toBe(true)
    expect(w.findComponent({ name: 'LoginGate' }).props('dismissible')).toBe(false)
    expect(w.find('.stub-NotesSidebar').exists()).toBe(false)
  })

  it('passes the chosen provider to the login', async () => {
    const w = make({})
    await w.findComponent({ name: 'LoginGate' }).vm.$emit('login', 'github')
    expect(m.auth.login).toHaveBeenCalledWith('github')
  })

  it('opens a dismissible gate to pick a provider from a public page, and closes it', async () => {
    m.auth.choosingProvider.value = true
    const w = make()
    const gate = w.findComponent({ name: 'LoginGate' })
    expect(gate.props('dismissible')).toBe(true)
    await gate.vm.$emit('close')
    expect(m.auth.choosingProvider.value).toBe(false)
  })

  it('offers the dice to a signed-in user only', async () => {
    const w = make()
    expect(w.find('.stub-DiceFab').exists()).toBe(false)
    m.auth.user.value = { name: 'GM' }
    await nextTick()
    for (const name of ['DiceFab', 'DicePanel', 'DiceToastStack']) expect(w.find(`.stub-${name}`).exists()).toBe(true)
  })

  it('leaves the sidebar, background and dice out of the fullscreen screen view', () => {
    m.auth.user.value = { name: 'GM' }
    const w = make({ public: true, fullscreen: true })
    expect(w.find('.stub-NotesSidebar').exists()).toBe(false)
    expect(w.find('.stub-NebulaBackground').exists()).toBe(false)
    expect(w.find('.stub-DiceFab').exists()).toBe(false)
    expect(w.find('.stub-DiceOverlay').exists()).toBe(true)
  })

  it('opens the sidebar search on a tag asked for anywhere below it', async () => {
    const w = make()
    w.vm.addTagFilter('npc')
    await flushPromises()
    expect(m.opened).toBe('npc')
  })

  it('tells a failed sign-in what happened, and strips it from the URL', async () => {
    window.history.replaceState(null, '', '/note/x?auth_error=not_allowed&keep=1')
    const w = make()
    await nextTick()
    expect(w.find('.auth-error-text').text()).toBe("This account isn't authorized for this vault.")
    expect(window.location.search).toBe('?keep=1')
    await w.find('.auth-error-close').trigger('click')
    expect(w.find('.auth-error').exists()).toBe(false)
  })

  it('has a generic message for an error code it does not know, and drops the bare query', async () => {
    window.history.replaceState(null, '', '/?auth_error=weird')
    const w = make()
    await nextTick()
    expect(w.find('.auth-error-text').text()).toBe('Sign-in failed. Please try again.')
    expect(window.location.search).toBe('')
  })

  it('offers a reload when the build is older than the server', async () => {
    const w = make()
    expect(w.find('.app-update').exists()).toBe(false)
    m.update.stale.value = true
    await nextTick()
    await w.find('.app-update button').trigger('click')
    expect(m.update.reload).toHaveBeenCalled()
  })

  it('reloads an out-of-date screen by itself, but not twice in a minute', async () => {
    make({ public: true, fullscreen: true })
    m.update.stale.value = true
    await nextTick()
    expect(m.update.reload).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem('realm-keeper-screen-reloaded-at')).toBeTruthy()
    m.update.stale.value = false
    await nextTick()
    m.update.stale.value = true
    await nextTick()
    expect(m.update.reload).toHaveBeenCalledTimes(1)
  })

  it('does not reload a page someone is working in by itself', async () => {
    make()
    m.update.stale.value = true
    await nextTick()
    expect(m.update.reload).not.toHaveBeenCalled()
  })
})
