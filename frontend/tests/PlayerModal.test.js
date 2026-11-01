// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

class FakeAudio extends EventTarget {
  constructor(src) {
    super()
    this.src = src || ''
    this.paused = true
    this.volume = 1
  }
  play() {
    if (FakeAudio.failNext) {
      FakeAudio.failNext = false
      return Promise.reject(new Error('NotSupportedError'))
    }
    this.paused = false
    return Promise.resolve()
  }
  pause() { this.paused = true }
  load() {}
  removeAttribute(name) { if (name === 'src') this.src = '' }
}

const track = (album, name) => ({ key: `${album}/${name}.mp3`, name, size: 1024 })
let library
// Uploads wait until the test lets them finish, reporting progress meanwhile.
const uploads = []
const api = {
  fetchAlbums: vi.fn(async () => Object.keys(library)),
  fetchTracks: vi.fn(async (album) => library[album].slice()),
  uploadTrack: vi.fn((album, file, onProgress) => new Promise((resolve) => uploads.push({ album, file, onProgress, resolve }))),
  renameAlbum: vi.fn(async () => {}),
  deleteAlbum: vi.fn(async () => {}),
  createAlbum: vi.fn(async () => {}),
  deleteTrack: vi.fn(async () => {}),
  moveTrack: vi.fn(async () => {}),
  renameTrack: vi.fn(async () => {}),
  streamUrl: (key) => `/stream/${key}`
}
vi.mock('@/api/player', () => api)

let wrapper

async function openOn(album) {
  wrapper = mount((await import('@/components/PlayerModal.vue')).default, { props: { isOpen: false }, attachTo: document.body })
  await wrapper.setProps({ isOpen: true })
  await flushPromises()
  const item = wrapper.findAll('.album-item').find(li => li.text().includes(album))
  await item.trigger('click')
  await flushPromises()
}

function pickFiles(...names) {
  const input = wrapper.find('input[type="file"]')
  Object.defineProperty(input.element, 'files', { value: names.map(name => ({ name })), configurable: true })
  return input.trigger('change')
}

beforeEach(() => {
  library = {
    Battle: [track('Battle', 'drums'), track('Battle', 'horns')],
    Tavern: [track('Tavern', 'lute')]
  }
  uploads.length = 0
  Object.values(api).forEach(fn => fn.mockClear?.())
  FakeAudio.failNext = false
  vi.stubGlobal('Audio', FakeAudio)
  vi.resetModules()
})

afterEach(() => {
  wrapper?.unmount()
  vi.unstubAllGlobals()
})

describe('PlayerModal', () => {
  it('shows each upload’s progress as it is reported', async () => {
    await openOn('Battle')
    await pickFiles('war-cry')
    await flushPromises()
    uploads[0].onProgress(0.5)
    await flushPromises()
    expect(wrapper.find('.progress-fill').attributes('style')).toContain('width: 50%')
  })

  it('uploads a whole batch into the album it was picked in', async () => {
    await openOn('Battle')
    await pickFiles('one', 'two')
    await flushPromises()
    await wrapper.findAll('.album-item').find(li => li.text().includes('Tavern')).trigger('click')
    await flushPromises()
    uploads[0].resolve()
    await flushPromises()
    uploads[1].resolve()
    await flushPromises()
    expect(uploads.map(u => [u.album, u.file.name])).toEqual([['Battle', 'one'], ['Battle', 'two']])
  })

  it('says an effect failed above the track list, which stays, until dismissed', async () => {
    await openOn('Battle')
    FakeAudio.failNext = true
    await wrapper.find('.sfx-play-btn').trigger('click')
    await flushPromises()
    expect(wrapper.find('.action-error').text()).toContain('Could not play the effect.')
    expect(wrapper.findAll('.track-item')).toHaveLength(2)
    await wrapper.find('.action-error-dismiss').trigger('click')
    expect(wrapper.find('.action-error').exists()).toBe(false)
  })

  it('says which track would not play', async () => {
    await openOn('Battle')
    FakeAudio.failNext = true
    await wrapper.find('.track-play-btn').trigger('click')
    await flushPromises()
    expect(wrapper.find('.action-error').text()).toContain('Could not play drums.')
    expect(wrapper.findAll('.track-item')).toHaveLength(2)
  })

  it('renames a track in place, once, with Enter', async () => {
    await openOn('Battle')
    await wrapper.find('[aria-label="Rename track"]').trigger('click')
    const input = wrapper.find('input.inline-rename')
    expect(document.activeElement).toBe(input.element)
    await input.setValue('  timpani ')
    await input.trigger('keyup', { key: 'Enter' })
    await input.trigger('blur')
    await flushPromises()
    expect(api.renameTrack).toHaveBeenCalledTimes(1)
    expect(api.renameTrack).toHaveBeenCalledWith('Battle/drums.mp3', 'timpani')
  })

  it('cancels a rename with Esc', async () => {
    await openOn('Battle')
    await wrapper.find('[aria-label="Rename album"]').trigger('click')
    const input = wrapper.find('input.inline-rename')
    await input.setValue('Skirmish')
    await input.trigger('keyup', { key: 'Escape' })
    await flushPromises()
    expect(wrapper.find('input.inline-rename').exists()).toBe(false)
    expect(api.renameAlbum).not.toHaveBeenCalled()
  })
})
