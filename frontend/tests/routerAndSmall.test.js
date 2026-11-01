// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'

vi.mock('@/views/Home.vue', () => ({ default: {} }))
vi.mock('@/views/NoteView.vue', () => ({ default: {} }))
vi.mock('@/views/ScreenView.vue', () => ({ default: {} }))

const { default: router } = await import('@/router')
const { useMediaQuery } = await import('@/composables/useMediaQuery')
const { useUnsavedChangesGuard } = await import('@/composables/useUnsavedChangesGuard')
const { useGraphModal } = await import('@/composables/useGraphModal')

describe('the router', () => {
  it('keeps notes with slashes in one param and every page public', () => {
    const names = router.getRoutes().map((r) => r.name)
    expect(names).toEqual(expect.arrayContaining(['Home', 'Note', 'Screen']))
    const note = router.resolve('/note/Places/Saltmarsh Docks')
    expect(note.params.notePath).toBe('Places/Saltmarsh Docks')
    expect(router.getRoutes().every((r) => r.meta.public)).toBe(true)
    expect(router.resolve('/screen').meta.fullscreen).toBe(true)
  })

  it('loads each view lazily', async () => {
    for (const r of router.getRoutes()) await expect(r.components.default()).resolves.toBeDefined()
  })
})

describe('useMediaQuery', () => {
  const originalMatchMedia = window.matchMedia
  afterEach(() => { window.matchMedia = originalMatchMedia })

  function host(query) {
    let matches
    const wrapper = mount(defineComponent({ setup() { matches = useMediaQuery(query); return () => h('div') } }))
    return { matches, wrapper }
  }

  it('is false when matchMedia does not exist', () => {
    window.matchMedia = undefined
    expect(host('(max-width: 1px)').matches.value).toBe(false)
  })

  it('follows the list and a resize, and stops listening on unmount', async () => {
    const handlers = {}
    const list = {
      matches: true,
      addEventListener: vi.fn((e, f) => { handlers[e] = f }),
      removeEventListener: vi.fn()
    }
    window.matchMedia = vi.fn(() => list)
    const { matches, wrapper } = host('(max-width: 700px)')
    expect(matches.value).toBe(true)
    list.matches = false
    handlers.change()
    expect(matches.value).toBe(false)
    list.matches = true
    window.dispatchEvent(new Event('resize'))
    expect(matches.value).toBe(true)
    wrapper.unmount()
    expect(list.removeEventListener).toHaveBeenCalledWith('change', handlers.change)
    list.matches = false
    window.dispatchEvent(new Event('resize'))
    expect(matches.value).toBe(true)
  })
})

describe('useUnsavedChangesGuard', () => {
  function host(dirty) {
    let guard
    const wrapper = mount(defineComponent({
      setup() { guard = useUnsavedChangesGuard(dirty, 'Discard?'); return () => h('div') }
    }))
    return { guard, wrapper }
  }

  it('blocks the tab from closing only while there are unsaved changes', () => {
    const dirty = ref(false)
    const { wrapper } = host(dirty)
    const clean = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(clean)
    expect(clean.defaultPrevented).toBe(false)
    dirty.value = true
    const unsaved = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(unsaved)
    expect(unsaved.defaultPrevented).toBe(true)
    wrapper.unmount()
    const after = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(after)
    expect(after.defaultPrevented).toBe(false)
  })

  it('asks before discarding only when something would be lost', () => {
    const dirty = ref(false)
    const { guard } = host(dirty)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    expect(guard.confirmDiscard()).toBe(true)
    expect(confirm).not.toHaveBeenCalled()
    dirty.value = true
    expect(guard.confirmDiscard()).toBe(false)
    expect(confirm).toHaveBeenCalledWith('Discard?')
    confirm.mockReturnValue(true)
    expect(guard.confirmDiscard()).toBe(true)
  })
})

describe('useGraphModal', () => {
  it('is one shared state', () => {
    expect(useGraphModal()).toBe(useGraphModal())
  })
})
