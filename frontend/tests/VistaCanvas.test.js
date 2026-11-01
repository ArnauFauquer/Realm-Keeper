// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

vi.mock('@/config/env', () => ({ apiUrl: '' }))
vi.mock('@/components/ObservatoryModal.vue', () => ({ default: { render: () => null } }))
vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })

const VistaCanvas = (await import('@/components/VistaCanvas.vue')).default

const pointer = (type, x, y, init = {}) =>
  new PointerEvent(type, { clientX: x, clientY: y, button: 0, buttons: 1, pointerId: 1, bubbles: true, ...init })
const frame = () => new Promise((resolve) => requestAnimationFrame(resolve))

let wrapper = null
afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

function mountVista() {
  const vista = {
    id: 'tavern', background_url: '/api/observatory/images/1a2b3c4d-tavern.png',
    vanishing_point: { x: 50, y: 40 }, background_offset_y: 50, assets: []
  }
  wrapper = mount(VistaCanvas, { attachTo: document.body, props: { vista, editable: true } })
  return { vista, wrapper }
}

describe('VistaCanvas', () => {
  it('places the pointer on the stage as it is drawn now, transforms included', async () => {
    const { vista, wrapper } = mountVista()
    // The stage as drawn mid-animation: scaled, so not where its layout says.
    wrapper.find('.stage-frame').element.getBoundingClientRect = () => ({ left: 100, top: 50, width: 800, height: 450 })
    wrapper.find('.vanishing-point').element.dispatchEvent(pointer('pointerdown', 500, 230))
    window.dispatchEvent(pointer('pointermove', 300, 140))
    window.dispatchEvent(pointer('pointerup', 300, 140))
    await frame()
    expect(vista.vanishing_point).toEqual({ x: 25, y: 20 })
    expect(wrapper.emitted('change')).toHaveLength(1)
  })

  it('puts the vanishing point back when the browser cancels the drag', async () => {
    const { vista, wrapper } = mountVista()
    wrapper.find('.stage-frame').element.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 450 })
    wrapper.find('.vanishing-point').element.dispatchEvent(pointer('pointerdown', 400, 180))
    window.dispatchEvent(pointer('pointermove', 100, 100))
    await frame()
    window.dispatchEvent(pointer('pointercancel', 100, 100))
    expect(vista.vanishing_point).toEqual({ x: 50, y: 40 })
    expect(wrapper.emitted('change')).toBeUndefined()
  })

  it('does not pan the background on a right click', async () => {
    const { vista, wrapper } = mountVista()
    wrapper.find('.stage-background').element.dispatchEvent(pointer('pointerdown', 400, 200, { button: 2 }))
    window.dispatchEvent(pointer('pointermove', 400, 400))
    await frame()
    expect(vista.background_offset_y).toBe(50)
  })
})
