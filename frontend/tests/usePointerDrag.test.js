// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { usePointerDrag } from '@/composables/usePointerDrag'

const pointer = (type, x, y, init = {}) =>
  new PointerEvent(type, { clientX: x, clientY: y, button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse', bubbles: true, ...init })
const frame = () => new Promise((resolve) => requestAnimationFrame(resolve))

let wrapper = null
afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

// A box whose pointerdown starts a drag, with the handlers spied on. The
// point is the map's: ten times smaller than the screen, as a big map shown small.
function setup(options = {}) {
  const calls = { onMove: vi.fn(), onEnd: vi.fn(), onCancel: vi.fn(), click: vi.fn() }
  let drag
  const Box = defineComponent({
    setup() {
      drag = usePointerDrag({ toPoint: (e) => ({ x: e.clientX * 10, y: e.clientY * 10 }), ...calls, ...options })
      return () => h('div', { class: 'box', onPointerdown: (e) => drag.start(e, { id: 'pin' }), onClick: calls.click })
    }
  })
  wrapper = mount(Box, { attachTo: document.body })
  return { calls, drag, box: wrapper.find('.box').element }
}

describe('usePointerDrag', () => {
  it('follows the pointer once a frame, with the newest move, and ends where it is let go', async () => {
    const { calls, box } = setup()
    box.dispatchEvent(pointer('pointerdown', 0, 0))
    window.dispatchEvent(pointer('pointermove', 5, 0))
    window.dispatchEvent(pointer('pointermove', 9, 0))
    expect(calls.onMove).not.toHaveBeenCalled()
    await frame()
    expect(calls.onMove).toHaveBeenCalledTimes(1)
    expect(calls.onMove.mock.calls[0][0]).toEqual({ x: 90, y: 0 })
    window.dispatchEvent(pointer('pointermove', 12, 0))
    window.dispatchEvent(pointer('pointerup', 12, 0))
    // The last move is applied before the drop, not lost with the frame.
    expect(calls.onMove.mock.calls.at(-1)[0]).toEqual({ x: 120, y: 0 })
    expect(calls.onEnd).toHaveBeenCalledWith({ id: 'pin' }, { moved: true })
  })

  it('is a click until the pointer has gone thresholdPx pixels of the screen', () => {
    const { calls, box } = setup({ thresholdPx: 4 })
    box.dispatchEvent(pointer('pointerdown', 0, 0))
    window.dispatchEvent(pointer('pointermove', 3, 0)) // 30 px of the map
    window.dispatchEvent(pointer('pointerup', 3, 0))
    expect(calls.onMove).not.toHaveBeenCalled()
    expect(calls.onEnd).toHaveBeenCalledWith({ id: 'pin' }, { moved: false })
  })

  it('swallows the click that follows a drag, and only that one', async () => {
    const { calls, box } = setup()
    box.dispatchEvent(pointer('pointerdown', 0, 0))
    window.dispatchEvent(pointer('pointermove', 20, 0))
    window.dispatchEvent(pointer('pointerup', 20, 0))
    box.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(calls.click).not.toHaveBeenCalled()
    box.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(calls.click).toHaveBeenCalledTimes(1)
  })

  it('only starts with the primary button, and follows only the pointer that started it', () => {
    const { calls, box, drag } = setup()
    box.dispatchEvent(pointer('pointerdown', 0, 0, { button: 2 }))
    expect(drag.active()).toBe(false)
    box.dispatchEvent(pointer('pointerdown', 0, 0))
    box.dispatchEvent(pointer('pointerdown', 50, 50, { pointerId: 2 }))
    window.dispatchEvent(pointer('pointerup', 50, 50, { pointerId: 2 }))
    expect(drag.active()).toBe(true)
    expect(calls.onEnd).not.toHaveBeenCalled()
  })

  it('cancels on pointercancel: onCancel, never onEnd', async () => {
    const { calls, box } = setup()
    box.dispatchEvent(pointer('pointerdown', 0, 0))
    window.dispatchEvent(pointer('pointermove', 20, 0))
    window.dispatchEvent(pointer('pointercancel', 20, 0))
    await frame()
    expect(calls.onMove).not.toHaveBeenCalled()
    expect(calls.onCancel).toHaveBeenCalledWith({ id: 'pin' }, { moved: true })
    expect(calls.onEnd).not.toHaveBeenCalled()
  })

  it('ends a mouse drag whose release never arrived (no button down any more)', () => {
    const { calls, box, drag } = setup()
    box.dispatchEvent(pointer('pointerdown', 0, 0))
    window.dispatchEvent(pointer('pointermove', 20, 0, { buttons: 0 }))
    expect(drag.active()).toBe(false)
    expect(calls.onEnd).toHaveBeenCalledTimes(1)
  })
})
