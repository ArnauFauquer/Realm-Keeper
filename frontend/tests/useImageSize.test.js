// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { useImageSize } from '@/composables/useImageSize'

vi.mock('@/config/env', () => ({ apiUrl: '' }))

// Images that load (or fail) when the test says so, in any order.
class FakeImage {
  constructor() {
    FakeImage.made.push(this)
  }

  set src(value) {
    this.url = value
  }

  load(width, height) {
    this.naturalWidth = width
    this.naturalHeight = height
    this.onload?.()
  }

  fail() {
    this.onerror?.()
  }
}

beforeEach(() => {
  FakeImage.made = []
  vi.stubGlobal('Image', FakeImage)
})
afterEach(() => vi.unstubAllGlobals())

describe('useImageSize', () => {
  it('gives the size once the image has loaded', () => {
    const { width, height, status } = useImageSize(() => '/api/observatory/images/1a2b3c4d-map.png')
    expect(status.value).toBe('loading')
    FakeImage.made[0].load(1400, 1050)
    expect([width.value, height.value, status.value]).toEqual([1400, 1050, 'ready'])
  })

  it('says when the image could not be loaded, instead of waiting forever', () => {
    const { width, status } = useImageSize(() => '/api/observatory/images/1a2b3c4d-gone.png')
    FakeImage.made[0].fail()
    expect([width.value, status.value]).toEqual([0, 'error'])
  })

  it('ignores an image that finishes loading after another was asked for', async () => {
    const url = ref('/api/observatory/images/1a2b3c4d-old.png')
    const { width, status } = useImageSize(() => url.value)
    url.value = '/api/observatory/images/1a2b3c4d-new.png'
    await nextTick()
    const [old, current] = FakeImage.made
    current.load(800, 600)
    old.load(4000, 3000)
    old.fail()
    expect([width.value, status.value]).toEqual([800, 'ready'])
  })

  it('has nothing to do without a URL', async () => {
    const url = ref(null)
    const { status } = useImageSize(() => url.value)
    expect(status.value).toBe('idle')
    expect(FakeImage.made).toHaveLength(0)
  })
})
