// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// A stand-in for <audio>: records what was played and lets a test fire
// the events the real element would.
class FakeAudio extends EventTarget {
  static instances = []
  constructor(src) {
    super()
    this.src = src
    this.volume = 1
    this.paused = true
    this.currentTime = 0
    this.duration = 0
    FakeAudio.instances.push(this)
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

let sfx

beforeEach(async () => {
  FakeAudio.instances = []
  vi.stubGlobal('Audio', FakeAudio)
  vi.resetModules()
  const { useSoundEffects } = await import('@/composables/useSoundEffects')
  sfx = useSoundEffects()
})

afterEach(() => {
  sfx.stopAll()
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('useSoundEffects', () => {
  it('plays several effects at once, each on its own element', async () => {
    await sfx.toggle('Efectos/puerta.mp3')
    await sfx.toggle('Efectos/relincho.mp3')
    expect(FakeAudio.instances).toHaveLength(2)
    expect(FakeAudio.instances.every((a) => !a.paused)).toBe(true)
    expect(FakeAudio.instances[0].src).toContain('/api/player/stream/')
    expect(sfx.playingKeys.value).toEqual(['Efectos/puerta.mp3', 'Efectos/relincho.mp3'])
    expect(sfx.playing['Efectos/puerta.mp3'].name).toBe('puerta')
  })

  it('stops an effect when its button is pressed again', async () => {
    await sfx.toggle('Efectos/grito.mp3')
    await sfx.toggle('Efectos/grito.mp3')
    expect(FakeAudio.instances[0].paused).toBe(true)
    expect(sfx.playingKeys.value).toEqual([])
  })

  it('tracks progress and forgets an effect once it ends', async () => {
    await sfx.toggle('Efectos/puerta.mp3')
    const audio = FakeAudio.instances[0]
    audio.duration = 4
    audio.currentTime = 1
    audio.dispatchEvent(new Event('timeupdate'))
    expect(sfx.playing['Efectos/puerta.mp3'].progress).toBe(0.25)
    audio.dispatchEvent(new Event('ended'))
    expect(sfx.playingKeys.value).toEqual([])
  })

  it('applies and remembers its own volume, apart from the music', async () => {
    await sfx.toggle('Efectos/puerta.mp3')
    sfx.setVolume(0.4)
    expect(FakeAudio.instances[0].volume).toBe(0.4)
    expect(localStorage.getItem('rk-sfx-volume')).toBe('0.4')
    await sfx.toggle('Efectos/relincho.mp3')
    expect(FakeAudio.instances[1].volume).toBe(0.4)
  })

  it('rejects and leaves nothing behind when a track cannot play', async () => {
    FakeAudio.failNext = true
    await expect(sfx.toggle('Efectos/roto.mp3')).rejects.toThrow()
    expect(sfx.playingKeys.value).toEqual([])
  })

  it('stops everything at once', async () => {
    await sfx.toggle('Efectos/puerta.mp3')
    await sfx.toggle('Efectos/relincho.mp3')
    sfx.stopAll()
    expect(FakeAudio.instances.every((a) => a.paused)).toBe(true)
    expect(sfx.playingKeys.value).toEqual([])
  })
})
