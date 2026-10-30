// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { flushPromises, mount as vtuMount } from '@vue/test-utils'

const m = vi.hoisted(() => ({
  push: vi.fn(),
  notes: null, tags: null, loading: null, error: null, hasMore: null, isLoadingMore: null,
  fetchNotes: vi.fn(), refreshNotes: vi.fn(), loadMoreNotes: vi.fn(), fetchTags: vi.fn(),
  version: null, stopListening: vi.fn(),
  user: null, login: vi.fn(), logout: vi.fn(),
  player: null, copy: vi.fn(), copiedKey: null, createScreenLink: vi.fn(),
  addExternalTag: vi.fn(), observers: []
}))

vi.mock('vue-router', () => ({ useRouter: () => ({ push: m.push }) }))
vi.mock('@/composables/useNotes', async () => {
  const { ref } = await import('vue')
  m.notes = ref([]); m.tags = ref([]); m.loading = ref(false); m.error = ref(null)
  m.hasMore = ref(false); m.isLoadingMore = ref(false); m.version = ref(0)
  return {
    listenForVaultChanges: () => m.stopListening,
    useNotesChanged: () => m.version,
    useNotes: () => ({
      notes: m.notes, availableTags: m.tags, loading: m.loading, error: m.error, hasMore: m.hasMore,
      isLoadingMore: m.isLoadingMore, fetchNotes: m.fetchNotes, refreshNotes: m.refreshNotes,
      loadMoreNotes: m.loadMoreNotes, fetchTags: m.fetchTags
    })
  }
})
vi.mock('@/composables/useAuth', async () => {
  const { ref } = await import('vue')
  m.user = ref(null)
  return { useAuth: () => ({ user: m.user, login: m.login, logout: m.logout }) }
})
vi.mock('@/composables/usePlayer', async () => {
  const { ref } = await import('vue')
  m.player = { isPlaying: ref(false), currentTrack: ref(null), volume: ref(0.5), setVolume: vi.fn() }
  return { usePlayer: () => m.player }
})
vi.mock('@/composables/useCopyToClipboard', async () => {
  const { ref } = await import('vue')
  m.copiedKey = ref(null)
  return { useCopyToClipboard: () => ({ copiedKey: m.copiedKey, copy: m.copy }) }
})
vi.mock('@/api/screen', () => ({ createScreenLink: m.createScreenLink }))
vi.mock('@/config/env', () => ({ appVersion: '9.9.9', apiUrl: '' }))

const modal = (name, extra = {}) => ({
  __esModule: true,
  default: defineComponent({ name, props: ['isOpen', 'notes', 'availableTags', 'startPath', 'startKind'], emits: ['close'], ...extra, render() { return h('div', { class: `modal-${name}` }) } })
})
vi.mock('@/components/SearchModal.vue', () => modal('SearchModal', { setup(_, { expose }) { expose({ addExternalTag: m.addExternalTag }); return () => h('div', { class: 'modal-SearchModal' }) } }))
vi.mock('@/components/GraphModal.vue', () => modal('GraphModal'))
vi.mock('@/components/PlayerModal.vue', () => modal('PlayerModal'))
vi.mock('@/components/ChartsModal.vue', () => modal('ChartsModal'))
vi.mock('@/components/VistasModal.vue', () => modal('VistasModal'))
vi.mock('@/components/EncountersModal.vue', () => modal('EncountersModal'))
vi.mock('@/components/BattlemapsModal.vue', () => modal('BattlemapsModal'))
vi.mock('@/components/CharactersModal.vue', () => modal('CharactersModal'))
vi.mock('@/components/AdversariesModal.vue', () => modal('AdversariesModal'))
vi.mock('@/components/ObservatoryModal.vue', () => modal('ObservatoryModal'))
vi.mock('@/components/PlayerTransport.vue', () => modal('PlayerTransport'))

const NotesSidebar = (await import('@/components/NotesSidebar.vue')).default
const { useGraphModal } = await import('@/composables/useGraphModal')
const { useObservatoryModal } = await import('@/composables/useObservatoryModal')

const RouterLink = { props: ['to'], template: '<a :href="to"><slot /></a>' }
const mounted = []
const mount = () => {
  const w = vtuMount(NotesSidebar, { attachTo: document.body, global: { stubs: { 'router-link': RouterLink } } })
  mounted.push(w)
  return w
}
const note = (id) => ({ id, title: id.split('/').pop() })

beforeEach(() => {
  m.notes.value = []
  m.tags.value = []
  m.loading.value = false
  m.error.value = null
  m.hasMore.value = false
  m.isLoadingMore.value = false
  m.user.value = null
  m.player.currentTrack.value = null
  m.player.isPlaying.value = false
  m.copiedKey.value = null
  m.version.value = 0
  for (const fn of [m.push, m.fetchNotes, m.refreshNotes, m.loadMoreNotes, m.fetchTags, m.stopListening, m.login, m.logout,
    m.copy, m.createScreenLink, m.addExternalTag, m.player.setVolume]) fn.mockReset()
  m.observers.length = 0
  globalThis.IntersectionObserver = class {
    constructor(cb) { this.cb = cb; this.observe = vi.fn(); this.disconnect = vi.fn(); m.observers.push(this) }
  }
  document.body.innerHTML = '<div class="main-content"></div>'
  useGraphModal().close()
  useObservatoryModal().close()
})
afterEach(() => { mounted.splice(0).forEach((w) => w.unmount()) })

describe('NotesSidebar loading the vault', () => {
  it('fetches notes and tags on mount and listens for the vault changing', () => {
    mount()
    expect(m.fetchNotes).toHaveBeenCalled()
    expect(m.fetchTags).toHaveBeenCalled()
  })

  it('stops listening and unlocks the page when it goes away', () => {
    const w = mount()
    w.unmount()
    mounted.length = 0
    expect(m.stopListening).toHaveBeenCalled()
  })

  it('shows the version', () => {
    expect(mount().find('.brand-version').text()).toBe('9.9.9')
  })

  it('refreshes the notes and tags when the vault changed', async () => {
    mount()
    m.version.value++
    await nextTick()
    expect(m.refreshNotes).toHaveBeenCalled()
    expect(m.fetchTags).toHaveBeenCalledTimes(2)
  })

  it('shows a skeleton while loading with no notes', () => {
    m.loading.value = true
    expect(mount().find('.tree-skeleton').exists()).toBe(true)
  })

  it('shows the error with a way to retry', async () => {
    m.error.value = 'Vault unreachable'
    const w = mount()
    expect(w.find('.tree-state').text()).toContain('Vault unreachable')
    await w.find('.tree-state button').trigger('click')
    expect(m.fetchNotes).toHaveBeenCalledTimes(2)
  })

  it('says the vault is empty, offering a new note only to someone signed in', () => {
    expect(mount().find('.rk-empty').text()).toContain('No notes in this vault yet')
    expect(document.querySelector('.rk-empty button')).toBeNull()
    m.user.value = { email: 'gm@example.com' }
    expect(mount().find('.rk-empty button').exists()).toBe(true)
  })
})

describe('NotesSidebar tree', () => {
  it('nests notes in folders by their path, with root notes beside them', () => {
    m.notes.value = [note('index'), note('People/Mirela'), note('People/Elves/Aria'), note('Places/Docks')]
    const w = mount()
    const roots = w.findAll('.notes-tree > .tree-item')
    expect(roots).toHaveLength(3)
    expect(w.text()).toContain('index')
    expect(w.findAll('.folder').map((f) => f.find('.row-label').text())).toEqual(['People', 'Places'])
  })

  it('expands and collapses a folder', async () => {
    m.notes.value = [note('People/Mirela'), note('People/Elves/Aria')]
    const w = mount()
    expect(w.find('.children').exists()).toBe(false)
    await w.find('.folder').trigger('click')
    expect(w.text()).toContain('Mirela')
    expect(w.findAll('.folder').map((f) => f.find('.row-label').text())).toEqual(['People', 'Elves'])
    await w.find('.folder').trigger('click')
    expect(w.find('.children').exists()).toBe(false)
  })
})

describe('NotesSidebar new note', () => {
  const signedIn = () => { m.user.value = { email: 'gm@example.com' } }

  it('offers it only when signed in', () => {
    expect(mount().find('[aria-label="New Note"]').exists()).toBe(false)
    signedIn()
    expect(mount().find('[aria-label="New Note"]').exists()).toBe(true)
  })

  it('asks for a path, cleans it up and opens the editor on a new note', async () => {
    signedIn()
    const w = mount()
    await w.find('[aria-label="New Note"]').trigger('click')
    await nextTick()
    const input = w.find('.rk-scrim input')
    expect(input.exists()).toBe(true)
    await input.setValue(' /People/New One/ ')
    await w.find('.rk-btn--primary').trigger('click')
    expect(m.push).toHaveBeenCalledWith('/note/People/New%20One?new=1')
    expect(w.find('.rk-scrim').exists()).toBe(false)
  })

  it('does not create a note without a path, and cancel closes the dialog', async () => {
    signedIn()
    const w = mount()
    await w.find('[aria-label="New Note"]').trigger('click')
    expect(w.find('.rk-btn--primary').attributes('disabled')).toBeDefined()
    await w.find('.rk-input, input').setValue('   ')
    await w.find('.rk-btn--primary').trigger('click')
    expect(m.push).not.toHaveBeenCalled()
    await w.find('.rk-scrim .rk-btn--ghost').trigger('click')
    expect(w.find('.rk-scrim').exists()).toBe(false)
  })
})

describe('NotesSidebar drawer', () => {
  it('opens on a phone, locking the page behind it, and closes again', async () => {
    const w = mount()
    const scroller = document.querySelector('.main-content')
    await w.find('.sidebar-toggle').trigger('click')
    expect(w.find('.sidebar').classes()).toContain('is-open')
    expect(w.find('.sidebar-toggle').attributes('aria-expanded')).toBe('true')
    expect(scroller.style.overflowY).toBe('hidden')
    await w.find('.sidebar-overlay').trigger('click')
    expect(w.find('.sidebar').classes()).not.toContain('is-open')
    expect(scroller.style.overflowY).toBe('')
  })

  it('closes when a note is picked', async () => {
    m.notes.value = [note('index')]
    const w = mount()
    await w.find('.sidebar-toggle').trigger('click')
    await w.find('.note-link').trigger('click')
    expect(w.find('.sidebar').classes()).not.toContain('is-open')
  })
})

describe('NotesSidebar search', () => {
  it('opens its modal from the button, only loading it then', async () => {
    const w = mount()
    expect(w.find('.modal-SearchModal').exists()).toBe(false)
    await w.find('.search-trigger').trigger('click')
    await flushPromises()
    expect(w.findComponent({ name: 'SearchModal' }).props('isOpen')).toBe(true)
    await w.findComponent({ name: 'SearchModal' }).vm.$emit('close')
    expect(w.findComponent({ name: 'SearchModal' }).props('isOpen')).toBe(false)
  })

  it('opens with Ctrl+K or Cmd+K, and ignores other combinations', async () => {
    const w = mount()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', altKey: true, ctrlKey: true }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k' }))
    await flushPromises()
    expect(w.find('.modal-SearchModal').exists()).toBe(false)
    const event = new KeyboardEvent('keydown', { key: 'K', ctrlKey: true, cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    await flushPromises()
    expect(w.findComponent({ name: 'SearchModal' }).props('isOpen')).toBe(true)
  })

  it('opens the search with a tag, waiting for the modal to load', async () => {
    const w = mount()
    w.vm.openSearchWithTag('npc')
    await flushPromises()
    expect(m.addExternalTag).toHaveBeenCalledWith('npc')
  })

  it('stops listening for the shortcut once gone', async () => {
    const w = mount()
    w.unmount()
    mounted.length = 0
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))
    await flushPromises()
    expect(document.querySelector('.modal-SearchModal')).toBeNull()
  })
})

describe('NotesSidebar signed out and in', () => {
  it('offers a sign-in and none of the tools to a visitor', async () => {
    const w = mount()
    expect(w.find('.observatory-tile').exists()).toBe(false)
    expect(w.find('.now-playing').exists()).toBe(false)
    expect(w.find('.modal-ChartsModal').exists()).toBe(false)
    await w.find('.sidebar-footer .rk-btn--block').trigger('click')
    expect(m.login).toHaveBeenCalled()
  })

  it('gives someone signed in the Observatory, the player and the document modals', async () => {
    m.user.value = { email: 'gm@example.com' }
    const w = mount()
    await flushPromises()
    for (const name of ['PlayerModal', 'ChartsModal', 'VistasModal', 'EncountersModal', 'BattlemapsModal', 'CharactersModal', 'AdversariesModal', 'ObservatoryModal']) {
      expect(w.find(`.modal-${name}`).exists(), name).toBe(true)
    }
    expect(w.find('.avatar').text()).toBe('G')
    expect(w.find('.account-email').text()).toBe('gm@example.com')
  })

  it('opens the Observatory at the top, or on one kind of document', async () => {
    m.user.value = { email: 'gm@example.com' }
    const w = mount()
    await w.find('.observatory-trigger').trigger('click')
    expect(useObservatoryModal().isOpen.value).toBe(true)
    expect(useObservatoryModal().kind.value).toBeNull()
    const kinds = w.findAll('.observatory-kind')
    expect(kinds).toHaveLength(6)
    await kinds[0].trigger('click')
    expect(useObservatoryModal().kind.value).toBe('chart')
  })

  it('signs out', async () => {
    m.user.value = { email: 'gm@example.com' }
    const w = mount()
    await w.find('[aria-label="Sign out"]').trigger('click')
    expect(m.logout).toHaveBeenCalled()
  })

  it('has no account row for the local user of a vault without a login', () => {
    m.user.value = { local: true, email: 'local' }
    const w = mount()
    expect(w.find('.account').exists()).toBe(false)
    expect(w.find('.now-playing').exists()).toBe(true)
  })

  it('shows what is playing and sets the volume', async () => {
    m.user.value = { email: 'gm@example.com' }
    const w = mount()
    expect(w.find('.track-title').text()).toBe('Nothing playing')
    m.player.currentTrack.value = { name: 'Tavern Brawl' }
    m.player.isPlaying.value = true
    await nextTick()
    expect(w.find('.track-title').text()).toBe('Tavern Brawl')
    expect(w.find('.track-icon').classes()).toContain('mdi-music')
    const volume = w.find('.volume-bar')
    volume.element.value = '0.25'
    await volume.trigger('input')
    expect(m.player.setVolume).toHaveBeenCalledWith(0.25)
  })

  it('copies the screen link, and says so', async () => {
    m.user.value = { email: 'gm@example.com' }
    m.createScreenLink.mockResolvedValue('https://app.test/screen#key=abc')
    const w = mount()
    await w.find('[aria-label="Copy screen link"]').trigger('click')
    await flushPromises()
    expect(m.copy).toHaveBeenCalledWith('https://app.test/screen#key=abc', 'screen-link', expect.any(String))
    m.copiedKey.value = 'screen-link'
    await nextTick()
    expect(w.find('[aria-label="Screen link copied"]').exists()).toBe(true)
  })

  it('copies nothing when the link cannot be made', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    m.user.value = { email: 'gm@example.com' }
    m.createScreenLink.mockRejectedValue(new Error('403'))
    const w = mount()
    await w.find('[aria-label="Copy screen link"]').trigger('click')
    await flushPromises()
    expect(m.copy).not.toHaveBeenCalled()
    log.mockRestore()
  })

  it('opens the graph on demand', async () => {
    const w = mount()
    useGraphModal().open()
    await flushPromises()
    expect(w.findComponent({ name: 'GraphModal' }).props('isOpen')).toBe(true)
    await w.findComponent({ name: 'GraphModal' }).vm.$emit('close')
    expect(useGraphModal().isOpen.value).toBe(false)
  })
})

describe('NotesSidebar paging', () => {
  it('loads the next page when the sentinel comes into view', async () => {
    m.notes.value = [note('a')]
    m.hasMore.value = true
    mount()
    await nextTick(); await nextTick()
    const observer = m.observers.at(-1)
    expect(observer.observe).toHaveBeenCalled()
    observer.cb([{ isIntersecting: false }])
    expect(m.loadMoreNotes).not.toHaveBeenCalled()
    observer.cb([{ isIntersecting: true }])
    expect(m.loadMoreNotes).toHaveBeenCalledTimes(1)
  })

  it('does not ask for another page while one is on its way, or when there is none', async () => {
    m.notes.value = [note('a')]
    m.hasMore.value = true
    m.isLoadingMore.value = true
    mount()
    await nextTick(); await nextTick()
    m.observers.at(-1).cb([{ isIntersecting: true }])
    expect(m.loadMoreNotes).not.toHaveBeenCalled()
    m.isLoadingMore.value = false
    m.hasMore.value = false
    m.observers.at(-1).cb([{ isIntersecting: true }])
    expect(m.loadMoreNotes).not.toHaveBeenCalled()
  })

  it('arms the sentinel again after each page, and lets go of the old observer', async () => {
    m.notes.value = [note('a')]
    m.hasMore.value = true
    mount()
    await nextTick(); await nextTick()
    const first = m.observers.at(-1)
    m.notes.value = [note('a'), note('b')]
    await nextTick(); await nextTick()
    expect(first.disconnect).toHaveBeenCalled()
    expect(m.observers.length).toBeGreaterThan(1)
  })
})
