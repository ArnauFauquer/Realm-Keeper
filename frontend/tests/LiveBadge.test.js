// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
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
  it('says whether changes arrive live', async () => {
    const wrapper = mount(LiveBadge)
    expect(wrapper.text()).toBe('Live')
    syncStatus.value.value = 'denied'
    await nextTick()
    expect(wrapper.text()).toBe('Signed out')
    expect(wrapper.attributes('title')).toContain('Sign in')
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
    expect(mount(LiveBadge, { attrs: { class: 'here' } }).classes()).toContain('here')
  })
})
