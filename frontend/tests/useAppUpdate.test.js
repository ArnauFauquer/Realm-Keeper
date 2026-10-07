// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { useAppUpdate, watchForUpdates } from '@/composables/useAppUpdate'

describe('useAppUpdate', () => {
  it('turns a part of the app that can no longer be loaded into an offer to reload', () => {
    const { stale } = useAppUpdate()
    watchForUpdates()
    watchForUpdates() // once is enough, however often it is asked
    expect(stale.value).toBe(false)
    const failure = new Event('vite:preloadError', { cancelable: true })
    window.dispatchEvent(failure)
    expect(stale.value).toBe(true)
    // Not swallowed: whoever imported still learns it failed, and falls back.
    expect(failure.defaultPrevented).toBe(false)
  })
})
