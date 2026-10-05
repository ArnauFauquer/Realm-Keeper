// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

const { guards, put, getCached } = vi.hoisted(() => ({ guards: {}, put: vi.fn(), getCached: vi.fn() }))

vi.mock('vue-router', () => ({
  onBeforeRouteLeave: (fn) => { guards.leave = fn },
  onBeforeRouteUpdate: (fn) => { guards.update = fn },
  useRouter: () => ({ push: vi.fn() })
}))
vi.mock('@/api/http', () => ({
  put,
  getCached,
  invalidateCached: vi.fn(),
  post: vi.fn(),
  errorMessage: (err, fallback) => err?.response?.data?.detail || fallback || err?.message
}))
vi.mock('@/config/env', () => ({ apiUrl: '' }))
vi.mock('@/composables/useNotes', () => ({ notifyNotesChanged: vi.fn() }))

const NoteEditor = (await import('@/components/NoteEditor.vue')).default

const conflict = () => Object.assign(new Error('409'), { response: { status: 409 } })
let wrapper

const mountEditor = (props = {}) => mount(NoteEditor, {
  props: { notePath: 'Places/Hall', title: 'Hall', content: '# Hall\n', sha: 's1', ...props },
  global: { stubs: { SheetRefPicker: true, MarkdownBody: { props: ['html'], template: '<div class="preview" v-html="html"></div>' } } }
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(window, 'confirm').mockReturnValue(false)
})

afterEach(() => wrapper?.unmount())

describe('NoteEditor', () => {
  it('saves against the loaded version and says so', async () => {
    put.mockResolvedValue({ status: 'updated', sha: 's2' })
    wrapper = mountEditor()
    await wrapper.find('textarea').setValue('# Hall\nMore')
    await wrapper.find('.rk-btn--primary').trigger('click')
    await flushPromises()

    expect(put).toHaveBeenCalledWith('/api/note/Places/Hall', { content: '# Hall\nMore', base_sha: 's1' })
    expect(wrapper.emitted('saved')).toHaveLength(1)
  })

  it('on a conflict keeps the draft and offers both ways out', async () => {
    put.mockRejectedValueOnce(conflict()).mockResolvedValueOnce({ status: 'updated', sha: 's3' })
    wrapper = mountEditor()
    await wrapper.find('textarea').setValue('# mine')
    await wrapper.find('.rk-btn--primary').trigger('click')
    await flushPromises()

    expect(wrapper.find('.conflict').text()).toContain('Someone else saved this note')
    expect(wrapper.find('textarea').element.value).toBe('# mine')
    expect(wrapper.emitted('saved')).toBeUndefined()

    const overwrite = wrapper.findAll('.conflict button').find((b) => b.text() === 'Overwrite')
    await overwrite.trigger('click')
    await flushPromises()
    expect(put).toHaveBeenLastCalledWith('/api/note/Places/Hall', { content: '# mine' })
    expect(wrapper.emitted('saved')).toHaveLength(1)
  })

  it('reloads their version on request', async () => {
    put.mockRejectedValueOnce(conflict())
    getCached.mockResolvedValueOnce({ content: '# theirs', sha: 's9' })
    wrapper = mountEditor()
    await wrapper.find('textarea').setValue('# mine')
    await wrapper.find('.rk-btn--primary').trigger('click')
    await flushPromises()

    await wrapper.findAll('.conflict button').find((b) => b.text() === 'Reload their version').trigger('click')
    await flushPromises()
    expect(wrapper.find('textarea').element.value).toBe('# theirs')
    expect(wrapper.find('.conflict').exists()).toBe(false)
  })

  it('asks before leaving with unsaved changes, not without', async () => {
    wrapper = mountEditor()
    expect(guards.leave()).toBe(true)
    expect(window.confirm).not.toHaveBeenCalled()

    await wrapper.find('textarea').setValue('# changed')
    expect(guards.leave()).toBe(false)
    expect(guards.update({ path: '/note/Other' }, { path: '/note/Places/Hall' })).toBe(false)
    expect(guards.update({ path: '/note/Places/Hall' }, { path: '/note/Places/Hall' })).toBe(true)
  })

  it('renders the preview only on its tab, with the note renderer', async () => {
    wrapper = mountEditor({ content: '## Fight & Loot\n' })
    expect(wrapper.find('.preview').exists()).toBe(false)
    await wrapper.findAll('.editor-tab')[1].trigger('click')
    expect(wrapper.find('.preview').html()).toContain('<h2 id="fight-loot">')
  })
})
