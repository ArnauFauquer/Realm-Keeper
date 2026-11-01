// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'

const size = vi.hoisted(() => ({ width: null, height: null, status: null }))
vi.mock('@/composables/useImageSize', async () => {
  const { ref } = await import('vue')
  return {
    useImageSize: () => {
      size.width = ref(0); size.height = ref(0); size.status = ref('loading')
      return size
    }
  }
})

const { useMapViewport } = await import('@/composables/useMapViewport')

function setup(options = {}) {
  let api
  const svgRef = ref(null)
  const groupRef = ref(null)
  const wrapper = mount(defineComponent({
    setup() {
      api = useMapViewport({ svgRef, groupRef, imageUrl: () => 'x.png', ...options })
      return () => h('svg', { ref: (el) => { svgRef.value = el } }, [h('g', { ref: (el) => { groupRef.value = el } })])
    }
  }), { attachTo: document.body })
  // jsdom has no SVG layout: give d3-zoom the box it reads.
  Object.defineProperty(svgRef.value, 'width', { value: { baseVal: { value: 100 } } })
  Object.defineProperty(svgRef.value, 'height', { value: { baseVal: { value: 50 } } })
  return { api, svgRef, groupRef, wrapper }
}

const originalDOMPoint = globalThis.DOMPoint
beforeEach(() => { document.body.innerHTML = '' })
afterEach(() => { globalThis.DOMPoint = originalDOMPoint })

describe('useMapViewport', () => {
  it('exposes the image size and status of useImageSize', () => {
    const { api } = setup()
    expect(api.naturalWidth).toBe(size.width)
    expect(api.imageStatus.value).toBe('loading')
  })

  it('turns a pointer event into a point of the map, or null without a group', () => {
    const { api, groupRef } = setup()
    const saved = groupRef.value
    groupRef.value = null
    expect(api.pointer({})).toBeNull()
    groupRef.value = saved
  })

  it('sets up zoom once the image has a size, and reports the view as it moves', async () => {
    const onView = vi.fn()
    const { api, svgRef, wrapper } = setup({ onView })
    svgRef.value.getScreenCTM = () => ({ inverse: () => ({}) })
    svgRef.value.getBoundingClientRect = () => ({ left: 0, top: 0, right: 100, bottom: 50 })
    globalThis.DOMPoint = class { constructor(x, y) { this.x = x; this.y = y } matrixTransform() { return this } }

    size.width.value = 200
    await nextTick(); await nextTick()

    api.zoomBy(2)
    expect(onView).toHaveBeenCalled()
    const rect = onView.mock.calls.at(-1)[0]
    expect(rect.width).toBeCloseTo(50)
    expect(rect.height).toBeCloseTo(25)

    api.fit()
    expect(onView.mock.calls.at(-1)[0]).toBeNull()
    wrapper.unmount()
  })

  it('reports no view when the SVG has no screen matrix', async () => {
    const onView = vi.fn()
    const { api, svgRef } = setup({ onView })
    svgRef.value.getScreenCTM = () => null
    size.width.value = 10
    await nextTick(); await nextTick()
    api.zoomBy(2)
    expect(onView).toHaveBeenLastCalledWith(null)
  })

  it('does not zoom a map that is not zoomable, and fit/zoomBy are harmless', async () => {
    const onView = vi.fn()
    const { api } = setup({ onView, zoomable: () => false })
    size.width.value = 10
    await nextTick(); await nextTick()
    expect(() => { api.zoomBy(2); api.fit() }).not.toThrow()
    expect(onView).not.toHaveBeenCalled()
  })

  it('puts the view back when the reset key changes', async () => {
    const onView = vi.fn()
    const key = ref('a')
    const { api, svgRef } = setup({ onView, resetKey: () => key.value })
    svgRef.value.getScreenCTM = () => null
    size.width.value = 10
    await nextTick(); await nextTick()
    api.zoomBy(2)
    onView.mockClear()
    key.value = 'b'
    await nextTick()
    expect(onView).toHaveBeenCalledWith(null)
  })
})
