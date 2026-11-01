// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// A stand-in for <audio>: records what plays, and lets a test end a track or
// make the next play() fail.
class FakeAudio extends EventTarget {
  static instance = null
  constructor() {
    super()
    this.src = ''
    this.paused = true
    this.currentTime = 0
    this.duration = 0
    this.volume = 1
    FakeAudio.instance = this
  }
  play() {
    if (FakeAudio.failNext) {
      const error = FakeAudio.failNext
      FakeAudio.failNext = null
      return Promise.reject(error)
    }
    this.paused = false
    this.dispatchEvent(new Event('play'))
    return Promise.resolve()
  }
  pause() {
    this.paused = true
    this.dispatchEvent(new Event('pause'))
  }
  removeAttribute(name) { if (name === 'src') this.src = '' }
  end() {
    this.paused = true
    this.dispatchEvent(new Event('ended'))
  }
}

const track = (album, name) => ({ key: `${album}/${name}.mp3`, name, size: 1 })
let library
const api = {
  fetchAlbums: vi.fn(async () => Object.keys(library)),
  fetchTracks: vi.fn(async (album) => library[album].slice()),
  uploadTrack: vi.fn(async (album, file) => { library[album].unshift(track(album, file.name)) }),
  deleteTrack: vi.fn(async (key) => {
    const album = key.split('/')[0]
    library[album] = library[album].filter(t => t.key !== key)
  }),
  renameAlbum: vi.fn(async () => {}),
  deleteAlbum: vi.fn(async () => {}),
  createAlbum: vi.fn(async () => {}),
  moveTrack: vi.fn(async () => {}),
  renameTrack: vi.fn(async () => {}),
  streamUrl: (key) => `/stream/${key}`
}
vi.mock('@/api/player', () => api)

let player
const audio = () => FakeAudio.instance
const playing = () => audio().src.replace('/stream/', '')

beforeEach(async () => {
  library = {
    Battle: [track('Battle', 'drums'), track('Battle', 'horns'), track('Battle', 'clash')],
    Tavern: [track('Tavern', 'lute'), track('Tavern', 'fiddle')]
  }
  Object.values(api).forEach(fn => fn.mockClear?.())
  FakeAudio.failNext = null
  vi.stubGlobal('Audio', FakeAudio)
  vi.resetModules()
  const { usePlayer } = await import('@/composables/usePlayer')
  player = usePlayer()
})

afterEach(() => vi.unstubAllGlobals())

describe('usePlayer queue', () => {
  it('browsing another album leaves the music and the transport alone', async () => {
    await player.selectAlbum('Battle')
    await player.playTrackAt(1)
    await player.selectAlbum('Tavern')
    expect(player.currentTrack.value.name).toBe('horns')
    expect(player.currentTrackIndex.value).toBe(-1)
    // Pause pauses the music instead of starting the browsed album.
    player.togglePlay()
    expect(audio().paused).toBe(true)
    expect(playing()).toBe('Battle/horns.mp3')
  })

  it('takes the next track from the album that plays, not the one browsed', async () => {
    await player.selectAlbum('Battle')
    await player.playTrackAt(0)
    await player.selectAlbum('Tavern')
    audio().end()
    expect(playing()).toBe('Battle/horns.mp3')
    player.playNext()
    expect(playing()).toBe('Battle/clash.mp3')
    player.playNext()
    expect(playing()).toBe('Battle/clash.mp3')
    player.playPrev()
    expect(playing()).toBe('Battle/horns.mp3')
  })

  it('resumes a paused track where it was', async () => {
    await player.selectAlbum('Battle')
    await player.playTrackAt(1)
    player.togglePlay()
    audio().currentTime = 42
    const src = audio().src
    player.togglePlay()
    expect(audio().paused).toBe(false)
    expect(audio().src).toBe(src)
    expect(audio().currentTime).toBe(42)
  })

  it('keeps its place by key when the playing album is refreshed', async () => {
    await player.selectAlbum('Battle')
    await player.playTrackAt(1)
    await player.uploadTrack({ name: 'war-cry' }, () => {})
    expect(player.tracks.value.map(t => t.name)).toEqual(['war-cry', 'drums', 'horns', 'clash'])
    expect(player.currentTrack.value.name).toBe('horns')
    expect(player.currentTrackIndex.value).toBe(2)
    audio().end()
    expect(playing()).toBe('Battle/clash.mp3')
  })

  it('refreshes the queue when its album changes while another is browsed', async () => {
    await player.selectAlbum('Battle')
    await player.playTrackAt(0)
    await player.selectAlbum('Tavern')
    await player.deleteTrack(track('Battle', 'horns'))
    expect(player.tracks.value.map(t => t.name)).toEqual(['lute', 'fiddle'])
    expect(player.playingTracks.value.map(t => t.name)).toEqual(['drums', 'clash'])
    audio().end()
    expect(playing()).toBe('Battle/clash.mp3')
  })

  it('uploads into the album it was given, whatever is browsed by then', async () => {
    await player.selectAlbum('Battle')
    await player.selectAlbum('Tavern')
    await player.uploadTrack({ name: 'late' }, () => {}, 'Battle')
    expect(api.uploadTrack).toHaveBeenCalledWith('Battle', { name: 'late' }, expect.any(Function))
    expect(player.tracks.value.map(t => t.name)).toEqual(['lute', 'fiddle'])
  })

  it('with nothing playing, play and next start the album browsed', async () => {
    await player.selectAlbum('Tavern')
    player.togglePlay()
    expect(playing()).toBe('Tavern/lute.mp3')
    player.playNext()
    expect(playing()).toBe('Tavern/fiddle.mp3')
  })

  it('stops the music when its album is deleted or renamed, not when another is', async () => {
    await player.selectAlbum('Battle')
    await player.playTrackAt(0)
    await player.selectAlbum('Tavern')
    await player.renameAlbum('Tavern', 'Inn')
    expect(audio().paused).toBe(false)
    await player.deleteAlbum('Battle')
    expect(audio().paused).toBe(true)
    expect(player.currentTrack.value).toBeNull()
  })
})

describe('usePlayer playback errors', () => {
  it('playTrackAt rejects when the track can not play, and says which', async () => {
    await player.selectAlbum('Battle')
    FakeAudio.failNext = Object.assign(new Error('blocked'), { name: 'NotAllowedError' })
    await expect(player.playTrackAt(2)).rejects.toThrow('blocked')
    expect(player.playError.value).toBe('Could not play clash.')
    await player.playTrackAt(0)
    expect(player.playError.value).toBeNull()
  })

  it('playByKey rejects for a missing track or one that will not play', async () => {
    await expect(player.playByKey('Battle/nope.mp3')).rejects.toThrow('Track not found')
    FakeAudio.failNext = new Error('404')
    await expect(player.playByKey('Tavern/lute.mp3')).rejects.toThrow('404')
    await expect(player.playByKey('Tavern/fiddle.mp3')).resolves.toBeUndefined()
    expect(playing()).toBe('Tavern/fiddle.mp3')
  })

  it('the transport never leaves an unhandled rejection, and a cut-short play is no error', async () => {
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    await player.selectAlbum('Battle')
    FakeAudio.failNext = new Error('404')
    player.togglePlay()
    FakeAudio.failNext = Object.assign(new Error('interrupted'), { name: 'AbortError' })
    player.playNext()
    await new Promise(resolve => setTimeout(resolve, 0))
    process.off('unhandledRejection', unhandled)
    expect(unhandled).not.toHaveBeenCalled()
    expect(player.playError.value).toBe('Could not play drums.')
  })
})
