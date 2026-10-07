// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'

const { syncStatus } = vi.hoisted(() => ({ syncStatus: { value: null } }))
vi.mock('@/composables/syncSocket', async () => {
  syncStatus.value = ref('open')
  return { syncStatus: syncStatus.value }
})

const LiveBadge = (await import('@/components/LiveBadge.vue')).default
const LiveDocumentState = (await import('@/components/LiveDocumentState.vue')).default

describe('LiveBadge', () => {
  afterEach(() => {
    syncStatus.value.value = 'open'
    vi.useRealTimers()
  })

  it('says nothing while changes arrive live, and when they stop', async () => {
    const wrapper = mount(LiveBadge)
    expect(wrapper.find('.live-badge').exists()).toBe(false)
    syncStatus.value.value = 'denied'
    await nextTick()
    expect(wrapper.text()).toBe('Signed out')
    expect(wrapper.find('.live-badge').attributes('title')).toContain('Sign in')
  })

  it('mentions a connection only once it takes a while', async () => {
    vi.useFakeTimers()
    const wrapper = mount(LiveBadge)
    syncStatus.value.value = 'connecting'
    await nextTick()
    expect(wrapper.find('.live-badge').exists()).toBe(false) // opening a document connects too, in a moment
    vi.advanceTimersByTime(2000)
    await nextTick()
    expect(wrapper.text()).toBe('Reconnecting…')
    syncStatus.value.value = 'open'
    await nextTick()
    expect(wrapper.find('.live-badge').exists()).toBe(false)
  })
})

describe('LiveDocumentState', () => {
  it('says the document is loading, gone, or why it failed', () => {
    const state = (status, error = null) => mount(LiveDocumentState, { props: { status, error, noun: 'map' } })
    expect(state('loading').text()).toContain('Loading map')
    expect(state('gone').text()).toContain('This map was moved or deleted')
    expect(state('error', 'Storage is unavailable').text()).toContain('Storage is unavailable')
  })

  it('takes the class its owner gives it (its root is one element)', () => {
    const wrapper = mount(LiveDocumentState, { props: { status: 'loading', noun: 'map' }, attrs: { class: 'editor-state' } })
    expect(wrapper.classes()).toEqual(['live-state', 'editor-state'])
    syncStatus.value.value = 'denied'
    expect(mount(LiveBadge, { attrs: { class: 'here' } }).classes()).toContain('here')
    syncStatus.value.value = 'open'
  })
})
