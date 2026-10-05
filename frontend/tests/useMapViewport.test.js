// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, ref } from 'vue'

const { zoom, filterFns, transforms } = vi.hoisted(() => {
  const filterFns = []
  const transforms = []
  const zoom = {
    scaleExtent: vi.fn(() => zoom),
    filter: vi.fn((fn) => { filterFns.push(fn); return zoom }),
    on: vi.fn(() => zoom),
    transform: 'transform'
  }
  return { zoom, filterFns, transforms }
})

// d3-zoom and d3.pointer need real SVG geometry; the composable's own logic
// (when to zoom, who may pan, when to reset) is what is checked here.
vi.mock('d3', () => ({
  zoom: () => zoom,
  zoomIdentity: 'identity',
  select: () => ({
    call: (fn, ...args) => {
      if (fn === zoom.transform) transforms.push(args[0])
      return { on: vi.fn() }
    },
    attr: vi.fn()
  }),
  pointer: (event) => [event.x, event.y]
}))
vi.mock('@/config/env', () => ({ apiUrl: '' }))

const { useMapViewport } = await import('@/composables/useMapViewport')
const settle = async () => {
  for (let i = 0; i < 4; i++) await nextTick()
}

class FakeImage {
  naturalWidth = 1400
  naturalHeight = 1050
  // An image always finishes loading after the code that asked for it, even a cached one.
  set src(value) {
    FakeImage.loaded.push(value)
    queueMicrotask(() => this.onload?.())
  }
}
FakeImage.loaded = []

let result
const mounted = []
function setup(options = {}) {
  const imageUrl = ref(options.imageUrl ?? '/api/observatory/images/1a2b3c4d-map.png')
  const svgRef = ref(document.createElementNS('http://www.w3.org/2000/svg', 'svg'))
  const groupRef = ref(document.createElementNS('http://www.w3.org/2000/svg', 'g'))
  const flags = { zoomable: options.zoomable ?? true, canPan: options.canPan ?? true }
  const resetKey = ref('a')
  const app = createApp(defineComponent({
    setup() {
      result = useMapViewport({
        svgRef, groupRef, imageUrl: () => imageUrl.value,
        zoomable: () => flags.zoomable, canPan: () => flags.canPan, resetKey: () => resetKey.value
      })
      return () => h('div')
    }
  }))
  app.mount(document.createElement('div'))
  mounted.push(app)
  return { imageUrl, groupRef, flags, resetKey }
}

beforeEach(() => {
  vi.stubGlobal('Image', FakeImage)
  FakeImage.loaded = []
  filterFns.length = 0
  transforms.length = 0
  zoom.filter.mockClear()
})

afterEach(() => {
  mounted.splice(0).forEach((app) => app.unmount())
  vi.unstubAllGlobals()
})

describe('useMapViewport', () => {
  it("takes the map's size from its image", async () => {
    setup()
    await settle()
    expect(FakeImage.loaded).toEqual(['/api/observatory/images/1a2b3c4d-map.png'])
    expect(result.naturalWidth.value).toBe(1400)
    expect(result.naturalHeight.value).toBe(1050)
  })

  it('has no size without an image, and follows the image when it changes', async () => {
    const { imageUrl } = setup({ imageUrl: null })
    expect(result.naturalWidth.value).toBe(0)
    imageUrl.value = '/api/other.png'
    await settle()
    expect(result.naturalWidth.value).toBe(1400)
    imageUrl.value = null
    await settle()
    expect(result.naturalWidth.value).toBe(0)
  })

  it('sets up zoom once the map has a size, where wheel always zooms and a drag pans only when allowed', async () => {
    const { flags } = setup()
    await settle()
    expect(filterFns).toHaveLength(1)
    const filter = filterFns[0]
    expect(filter({ type: 'wheel' })).toBe(true)
    expect(filter({ type: 'mousedown', button: 0 })).toBe(true)
    expect(filter({ type: 'mousedown', button: 2 })).toBe(false)
    flags.canPan = false
    expect(filter({ type: 'mousedown', button: 0 })).toBe(false)
    expect(filter({ type: 'wheel' })).toBe(true)
  })

  it('does not zoom what is not zoomable', async () => {
    setup({ zoomable: false })
    await settle()
    expect(filterFns).toHaveLength(0)
  })

  it('puts the view back when the key changes', async () => {
    const { resetKey } = setup()
    await settle()
    resetKey.value = 'b'
    await settle()
    expect(transforms).toEqual(['identity'])
  })

  it('turns a pointer event into a point of the map', () => {
    const { groupRef } = setup()
    expect(result.pointer({ x: 12, y: 34 })).toEqual({ x: 12, y: 34 })
    groupRef.value = null
    expect(result.pointer({ x: 12, y: 34 })).toBeNull()
  })
})
