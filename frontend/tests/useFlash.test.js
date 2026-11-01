import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'
import { useFlash } from '@/composables/useFlash'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('useFlash', () => {
  it('is on for a while after each flash, and a second flash starts the time again', () => {
    const { on, flash } = useFlash(2000)
    expect(on.value).toBe(false)
    flash()
    expect(on.value).toBe(true)
    vi.advanceTimersByTime(1500)
    flash()
    vi.advanceTimersByTime(1500)
    expect(on.value).toBe(true)
    vi.advanceTimersByTime(600)
    expect(on.value).toBe(false)
  })

  it('leaves no timer behind once its component is gone', () => {
    const scope = effectScope()
    const { flash } = scope.run(() => useFlash(2000))
    flash()
    expect(vi.getTimerCount()).toBe(1)
    scope.stop()
    expect(vi.getTimerCount()).toBe(0)
  })
})
