import { onBeforeUnmount } from 'vue'

/**
 * A drag with the pointer, done the same way on every canvas (the chart, the
 * vista, the battlemap): pressing something starts it, moving moves it,
 * letting go commits it.
 *
 * - Only the primary button (a left click, a finger, a pen's tip) drags; a
 *   right click doesn't leave a pin following the cursor.
 * - The pointer that started it is the only one followed: a second finger
 *   doesn't take the drag over.
 * - The pointer is captured, and the moves are followed on the window, so
 *   passing over a panel or a toolbar, or out of the canvas, doesn't end it.
 *   A move with no button down (the release happened outside the window and
 *   never arrived) ends it there.
 * - Moves are applied at most once a frame, the newest one.
 * - Until the pointer has gone `thresholdPx` screen pixels it is a click, not a
 *   drag: a tap with a little wobble doesn't move what it touched, whatever the
 *   zoom.
 * - `pointercancel` (the browser took the gesture over) cancels: `onCancel`
 *   puts things back, nothing is committed.
 * - The click that follows a drag is swallowed, so dropping something isn't
 *   also a click on whatever is under it.
 *
 * `start(event, state)` is called from a pointerdown handler; `state` is the
 * caller's, handed back to `onMove(point, event, state)`, `onEnd(state,
 * { moved })` and `onCancel(state, { moved })`. `point` is `toPoint(event)`
 * (the event itself without one); a move whose point is null is skipped.
 */
export function usePointerDrag({ toPoint = (event) => event, thresholdPx = 0, onMove, onEnd, onCancel } = {}) {
  let drag = null
  let frame = 0
  let pending = null

  function apply() {
    frame = 0
    const event = pending
    pending = null
    if (!drag || !event) return
    const point = toPoint(event)
    if (point !== null && point !== undefined) onMove?.(point, event, drag.state)
  }

  function onPointerMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) return
    if (event.buttons === 0 && event.pointerType === 'mouse') {
      finish(event, false)
      return
    }
    if (!drag.moved) {
      if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < thresholdPx) return
      drag.moved = true
    }
    pending = event
    if (!frame) frame = requestAnimationFrame(apply)
  }

  function onPointerUp(event) {
    if (drag && event.pointerId === drag.pointerId) finish(event, false)
  }

  function onPointerCancel(event) {
    if (drag && event.pointerId === drag.pointerId) finish(event, true)
  }

  function listen(on) {
    const method = on ? 'addEventListener' : 'removeEventListener'
    window[method]('pointermove', onPointerMove)
    window[method]('pointerup', onPointerUp)
    window[method]('pointercancel', onPointerCancel)
  }

  function finish(event, cancelled) {
    const { state, moved, target, pointerId } = drag
    if (cancelled) {
      cancelAnimationFrame(frame)
      frame = 0
      pending = null
    } else if (frame) {
      // The last move first, so the drop lands where the pointer let go.
      cancelAnimationFrame(frame)
      apply()
    }
    drag = null
    listen(false)
    try {
      target?.releasePointerCapture?.(pointerId)
    } catch {
      // Already released (the element went away).
    }
    if (moved && !cancelled) swallowNextClick()
    if (cancelled) onCancel?.(state, { moved })
    else onEnd?.(state, { moved })
  }

  /** Starts a drag from a pointerdown. False (and nothing started) for
   * another button, or while another pointer is dragging. */
  function start(event, state = {}) {
    if (drag || event.button !== 0) return false
    drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false, state, target: event.currentTarget }
    try {
      event.currentTarget?.setPointerCapture?.(event.pointerId)
    } catch {
      // A synthetic event (or a pointer already gone) has nothing to capture.
    }
    listen(true)
    return true
  }

  /** Ends the drag as if the pointer had been let go of where it is. */
  function stop() {
    if (drag) finish(null, true)
  }

  onBeforeUnmount(() => {
    if (!drag) return
    cancelAnimationFrame(frame)
    drag = null
    listen(false)
  })

  return {
    start,
    stop,
    /** Whether a drag is going on. */
    active: () => drag !== null,
    /** Whether the drag going on has moved yet. */
    moved: () => !!drag?.moved
  }
}

// The click a browser fires after a drag that ended over the same element (or,
// with the pointer captured, on the captured one). Swallowed in the capture
// phase, before anything else sees it; if none comes, the guard goes away by
// itself.
function swallowNextClick() {
  const swallow = (event) => {
    event.stopPropagation()
    event.preventDefault()
    done()
  }
  const done = () => {
    window.removeEventListener('click', swallow, true)
    clearTimeout(timer)
  }
  window.addEventListener('click', swallow, true)
  const timer = setTimeout(done, 50)
}
