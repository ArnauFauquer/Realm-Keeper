// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { flushPromises, mount as vtuMount } from '@vue/test-utils'

const m = vi.hoisted(() => ({
  getCached: vi.fn(), route: { query: {}, hash: '' }, user: null, wide: null, version: null, addTagFilter: vi.fn()
}))
vi.mock('@/api/http', () => ({
  getCached: m.getCached,
  errorMessage: (err) => err?.response?.data?.detail || err?.message || 'Something went wrong.'
}))
vi.mock('@/config/env', () => ({ apiUrl: '' }))
vi.mock('vue-router', () => ({ useRoute: () => m.route }))
vi.mock('@/composables/useAuth', async () => {
  const { ref } = await import('vue')
  m.user = ref(null)
  return { useAuth: () => ({ user: m.user }) }
})
vi.mock('@/composables/useMediaQuery', async () => {
  const { ref } = await import('vue')
  m.wide = ref(true)
  return { useMediaQuery: () => m.wide }
})
vi.mock('@/composables/useNotes', async () => {
  const { ref } = await import('vue')
  m.version = ref(0)
  return { useNotesChanged: () => m.version }
})
vi.mock('@/components/RightSidebar.vue', () => ({
  default: defineComponent({ name: 'RightSidebar', props: ['note', 'headings'], render() { return h('aside', { class: 'stub-aside' }) } })
}))
vi.mock('@/components/MarkdownBody.vue', () => ({
  default: defineComponent({
    name: 'MarkdownBody',
    props: ['html', 'pageTitle'],
    emits: ['link-hover', 'rendered'],
    render() { return h('div', { class: 'stub-body', innerHTML: this.html }) }
  })
}))
vi.mock('@/components/NoteEditor.vue', () => ({
  default: defineComponent({
    name: 'NoteEditor',
    props: ['notePath', 'title', 'content', 'sha', 'creating'],
    emits: ['saved', 'cancel'],
    render() { return h('div', { class: 'stub-editor' }) }
  })
}))

const NoteView = (await import('@/views/NoteView.vue')).default

const RouterLink = { props: ['to'], template: '<a :href="to"><slot /></a>' }
const mounted = []
const mount = (notePath = 'People/Mirela', provide = {}) => {
  const w = vtuMount(NoteView, {
    props: { notePath },
    global: { stubs: { 'router-link': RouterLink }, provide }
  })
  mounted.push(w)
  return w
}

const NOTE = {
  id: 'People/Mirela', title: 'Captain Mirela', tags: ['npc', 'pirate'], links: ['Places/Docks', 'a', 'b', 'c', 'd', 'e', 'f'],
  content: '# Captain Mirela\n\nShe sails.\n\n![map](/api/observatory/images/1a2b3c4d-map.png)\n'
}
let notes

beforeEach(() => {
  notes = { 'People/Mirela': NOTE }
  m.getCached.mockReset().mockImplementation(async (url) => {
    if (url.includes('/api/container-folders')) return { People: 'People/People' }
    if (url.includes('/api/note-raw/')) return { content: '# raw', sha: 'abc' }
    const id = decodeURIComponent(url.split('/api/note/')[1])
    if (notes[id]) return notes[id]
    throw { response: { status: 404 } }
  })
  m.route.query = {}
  m.route.hash = ''
  m.user.value = null
  m.wide.value = true
  m.version.value = 0
  m.addTagFilter.mockReset()
  window.requestIdleCallback = (fn) => fn()
  // jsdom has no CSS.escape (every browser does).
  globalThis.CSS = { escape: (value) => value }
})
afterEach(() => {
  mounted.splice(0).forEach((w) => w.unmount())
  delete globalThis.CSS
})

describe('NoteView reading', () => {
  it('shows a skeleton while loading, then the note', async () => {
    let arrive
    m.getCached.mockImplementation((url) => (url.includes('/api/note/') ? new Promise((r) => { arrive = r }) : Promise.resolve({})))
    const w = mount()
    expect(w.find('.note-loading').exists()).toBe(true)
    arrive(NOTE)
    await flushPromises()
    expect(w.find('h1').text()).toBe('Captain Mirela')
    expect(w.find('.stub-body').html()).toContain('She sails.')
  })

  it('fetches the note by its encoded path', async () => {
    notes['Places/Rusty Anchor'] = { ...NOTE, id: 'Places/Rusty Anchor', title: 'Anchor' }
    mount('Places/Rusty Anchor')
    await flushPromises()
    expect(m.getCached.mock.calls.some(([url]) => url === '/api/note/Places/Rusty%20Anchor')).toBe(true)
  })

  it('lists the tags and hands a clicked one to the sidebar search', async () => {
    const w = mount('People/Mirela', { addTagFilter: m.addTagFilter })
    await flushPromises()
    const tags = w.findAll('.tag')
    expect(tags.map((t) => t.text())).toEqual(['#npc', '#pirate'])
    await tags[1].trigger('click')
    expect(m.addTagFilter).toHaveBeenCalledWith('pirate')
  })

  it('draws a breadcrumb whose folders link to their note when they have one', async () => {
    notes['People/Crew/Mirela'] = { ...NOTE, id: 'People/Crew/Mirela' }
    const w = mount('People/Crew/Mirela')
    await flushPromises()
    const crumbs = w.find('.note-breadcrumb')
    expect(crumbs.findAll('a').map((a) => [a.text(), a.attributes('href')])).toEqual([
      ['Notes', '/'], ['People', '/note/People/People']
    ])
    // A folder without a note is plain text; the note itself is the last crumb.
    expect(crumbs.findAll('.breadcrumb-current').map((c) => c.text())).toEqual(['Crew', 'Mirela'])
  })

  it('keeps library images for people who are signed in', async () => {
    const out = mount()
    await flushPromises()
    expect(out.find('.stub-body').html()).not.toContain('/api/observatory/images/1a2b3c4d-map.png')
    m.user.value = { email: 'gm@example.com' }
    const signedIn = mount()
    await flushPromises()
    expect(signedIn.find('.stub-body').html()).toContain('/api/observatory/images/1a2b3c4d-map.png')
  })

  it('shows the side panel only where there is room, with the headings', async () => {
    const w = mount()
    await flushPromises()
    expect(w.findComponent({ name: 'RightSidebar' }).props('note')).toMatchObject({ id: 'People/Mirela' })
    expect(w.findComponent({ name: 'RightSidebar' }).props('headings')).toEqual(expect.arrayContaining([expect.objectContaining({ text: 'Captain Mirela' })]))
    m.wide.value = false
    await nextTick()
    expect(w.find('.stub-aside').exists()).toBe(false)
  })

  it('prefetches the first five linked notes once the browser is idle', async () => {
    mount()
    await flushPromises()
    const prefetched = m.getCached.mock.calls.map(([url]) => url).filter((u) => u.includes('/api/note/') && !u.endsWith('/People/Mirela'))
    expect(prefetched).toHaveLength(5)
    expect(prefetched[0]).toBe('/api/note/Places/Docks')
  })

  it('prefetches after a second without requestIdleCallback', async () => {
    vi.useFakeTimers()
    delete window.requestIdleCallback
    mount()
    await vi.advanceTimersByTimeAsync(0)
    const before = m.getCached.mock.calls.length
    await vi.advanceTimersByTimeAsync(1000)
    expect(m.getCached.mock.calls.length).toBeGreaterThan(before)
    vi.useRealTimers()
  })

  it('prefetches a hovered link once', async () => {
    const w = mount()
    await flushPromises()
    const body = w.findComponent({ name: 'MarkdownBody' })
    const before = m.getCached.mock.calls.length
    body.vm.$emit('link-hover', 'People/Elves')
    body.vm.$emit('link-hover', 'People/Elves')
    expect(m.getCached.mock.calls.length).toBe(before + 1)
    expect(m.getCached.mock.calls.at(-1)[1]).toMatchObject({ timeout: 1500 })
  })

  it('loads another note when the path changes', async () => {
    notes['Places/Docks'] = { ...NOTE, id: 'Places/Docks', title: 'Docks', tags: [], links: [] }
    const w = mount()
    await flushPromises()
    await w.setProps({ notePath: 'Places/Docks' })
    await flushPromises()
    expect(w.find('h1').text()).toBe('Docks')
  })

  it('reloads the folder links when notes changed', async () => {
    mount()
    await flushPromises()
    const before = m.getCached.mock.calls.filter(([u]) => u.includes('container-folders')).length
    m.version.value++
    await flushPromises()
    expect(m.getCached.mock.calls.filter(([u]) => u.includes('container-folders')).length).toBe(before + 1)
  })

  it('lives without folder links when they cannot be loaded', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    m.getCached.mockImplementation(async (url) => {
      if (url.includes('container-folders')) throw new Error('down')
      return NOTE
    })
    const w = mount()
    await flushPromises()
    expect(w.find('h1').text()).toBe('Captain Mirela')
    expect(log).toHaveBeenCalled()
    log.mockRestore()
  })
})

describe('NoteView placing the note', () => {
  const place = (w, el) => w.findComponent({ name: 'MarkdownBody' }).vm.$emit('rendered', el)

  it('opens at the heading a shared link names', async () => {
    m.route.hash = '#she-sails'
    const w = mount()
    await flushPromises()
    const el = document.createElement('div')
    el.innerHTML = '<h2 id="she-sails">She sails</h2>'
    const heading = el.firstChild
    heading.scrollIntoView = vi.fn()
    place(w, el)
    expect(heading.scrollIntoView).toHaveBeenCalledWith({ block: 'start' })
  })

  it('opens at the top otherwise, once per note', async () => {
    const w = mount('People/Mirela')
    await flushPromises()
    const scroller = document.createElement('div')
    scroller.className = 'main-content'
    scroller.scrollTo = vi.fn()
    const el = document.createElement('div')
    scroller.append(el)
    place(w, el)
    place(w, el)
    expect(scroller.scrollTo).toHaveBeenCalledTimes(1)
    expect(scroller.scrollTo).toHaveBeenCalledWith({ top: 0 })
  })

  it('opens at the top for a hash that is not valid', async () => {
    m.route.hash = '#%E0%A4%A'
    notes['Places/Elsewhere'] = { ...NOTE, id: 'Places/Elsewhere' }
    const w = mount('Places/Elsewhere')
    await flushPromises()
    const scroller = document.createElement('div')
    scroller.className = 'main-content'
    scroller.scrollTo = vi.fn()
    const el = document.createElement('div')
    scroller.append(el)
    place(w, el)
    expect(scroller.scrollTo).toHaveBeenCalledWith({ top: 0 })
  })
})

describe('NoteView a note that is not there', () => {
  it('says so, asking a visitor to sign in to create it', async () => {
    const w = mount('Nowhere/Yet')
    await flushPromises()
    expect(w.find('.not-found').text()).toContain("This note doesn't exist yet")
    expect(w.find('.not-found-path').text()).toBe('Nowhere/Yet')
    expect(w.text()).toContain('Sign in to create it')
    expect(w.find('.stub-editor').exists()).toBe(false)
  })

  it('offers to create it to someone signed in, starting from a title', async () => {
    m.user.value = { email: 'gm@example.com' }
    const w = mount('Nowhere/Yet')
    await flushPromises()
    await w.find('.rk-btn--primary').trigger('click')
    const editor = w.findComponent({ name: 'NoteEditor' })
    expect(editor.props()).toMatchObject({ notePath: 'Nowhere/Yet', content: '# Yet\n\n', sha: null, creating: true })
  })

  it('opens the editor straight away after "New note" (?new=1)', async () => {
    m.user.value = { email: 'gm@example.com' }
    m.route.query = { new: '1' }
    const w = mount('Nowhere/Yet')
    await flushPromises()
    expect(w.findComponent({ name: 'NoteEditor' }).props('creating')).toBe(true)
  })

  it('waits for the session before opening the editor on ?new=1', async () => {
    m.route.query = { new: '1' }
    const w = mount('Nowhere/Yet')
    await flushPromises()
    expect(w.find('.stub-editor').exists()).toBe(false)
    m.user.value = { email: 'gm@example.com' }
    await flushPromises()
    expect(w.find('.stub-editor').exists()).toBe(true)
  })

  it('does not open the editor on ?new=1 for a visitor', async () => {
    m.route.query = { new: '1' }
    const w = mount('Nowhere/Yet')
    await flushPromises()
    expect(w.find('.stub-editor').exists()).toBe(false)
  })
})

describe('NoteView errors', () => {
  it('shows why a note could not be loaded', async () => {
    m.getCached.mockImplementation(async (url) => {
      if (url.includes('/api/note/')) throw { response: { status: 500, data: { detail: 'Vault unreadable' } } }
      return {}
    })
    const w = mount()
    await flushPromises()
    expect(w.find('.note-error').text()).toContain('Could not load this note')
    expect(w.find('.note-error').text()).toContain('Vault unreadable')
    expect(w.find('.stub-aside').exists()).toBe(false)
  })
})

describe('NoteView editing', () => {
  beforeEach(() => { m.user.value = { email: 'gm@example.com' } })

  it('offers editing only to someone signed in', async () => {
    m.user.value = null
    const w = mount()
    await flushPromises()
    expect(w.find('.edit-note-btn').exists()).toBe(false)
  })

  it('opens the editor on the raw file and its sha, hiding the side panel', async () => {
    const w = mount()
    await flushPromises()
    await w.find('.edit-note-btn').trigger('click')
    await flushPromises()
    expect(w.findComponent({ name: 'NoteEditor' }).props()).toMatchObject({
      notePath: 'People/Mirela', title: 'Captain Mirela', content: '# raw', sha: 'abc', creating: false
    })
    expect(w.find('.stub-aside').exists()).toBe(false)
    expect(m.getCached.mock.calls.some(([url, options]) => url === '/api/note-raw/People/Mirela' && options.useCache === false)).toBe(true)
  })

  it('closes the editor on cancel, and shows the note again once saved', async () => {
    const w = mount()
    await flushPromises()
    await w.find('.edit-note-btn').trigger('click')
    await flushPromises()
    await w.findComponent({ name: 'NoteEditor' }).vm.$emit('cancel')
    expect(w.find('.stub-editor').exists()).toBe(false)
    await w.find('.edit-note-btn').trigger('click')
    await flushPromises()
    notes['People/Mirela'] = { ...NOTE, title: 'Captain Mirela, edited' }
    await w.findComponent({ name: 'NoteEditor' }).vm.$emit('saved')
    await flushPromises()
    expect(w.find('.stub-editor').exists()).toBe(false)
  })

  it('shows the reason when the file cannot be opened for editing', async () => {
    const w = mount()
    await flushPromises()
    m.getCached.mockImplementation(async (url) => {
      if (url.includes('note-raw')) throw { response: { data: { detail: 'Not allowed' } } }
      return NOTE
    })
    await w.find('.edit-note-btn').trigger('click')
    await flushPromises()
    expect(w.find('.note-error').text()).toContain('Not allowed')
  })

  it('drops an editor whose file came back after the view moved on', async () => {
    notes['Places/Docks'] = { ...NOTE, id: 'Places/Docks', title: 'Docks' }
    const w = mount()
    await flushPromises()
    let arrive
    m.getCached.mockImplementation((url) => (url.includes('note-raw') ? new Promise((r) => { arrive = r }) : Promise.resolve(notes['Places/Docks'])))
    await w.find('.edit-note-btn').trigger('click')
    await w.setProps({ notePath: 'Places/Docks' })
    await flushPromises()
    arrive({ content: 'old note', sha: 'zzz' })
    await flushPromises()
    expect(w.find('.stub-editor').exists()).toBe(false)
    expect(w.find('h1').text()).toBe('Docks')
  })
})
