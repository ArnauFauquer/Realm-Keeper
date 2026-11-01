// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

const auth = vi.hoisted(() => ({}))
vi.mock('@/composables/useAuth', async () => {
  const { ref } = await import('vue')
  auth.providers = ref(null)
  auth.loadProviders = vi.fn()
  return { useAuth: () => auth }
})
const LoginGate = (await import('@/components/LoginGate.vue')).default

describe('LoginGate', () => {
  it('asks for the providers on mount and shows a skeleton until they come', () => {
    const w = mount(LoginGate)
    expect(auth.loadProviders).toHaveBeenCalled()
    expect(w.find('.provider-skeleton').exists()).toBe(true)
    expect(w.find('.providers').attributes('aria-busy')).toBe('true')
  })

  it('has one button per provider, and emits the one clicked', async () => {
    auth.providers.value = [{ id: 'google', name: 'Google' }, { id: 'github', name: 'GitHub' }, { id: 'dex', name: 'Company' }]
    const w = mount(LoginGate)
    const buttons = w.findAll('.provider-btn')
    expect(buttons.map((b) => b.text())).toEqual(['Sign in with Google', 'Sign in with GitHub', 'Sign in with Company'])
    expect(buttons[0].find('svg').exists()).toBe(true)
    expect(buttons[1].find('.mdi-github').exists()).toBe(true)
    expect(buttons[2].find('.mdi-shield-key-outline').exists()).toBe(true)
    await buttons[1].trigger('click')
    expect(w.emitted('login')[0]).toEqual(['github'])
  })

  it('explains when the server has no sign-in method', () => {
    auth.providers.value = []
    expect(mount(LoginGate).text()).toContain('No sign-in method is set up')
  })

  it('shows an error, and a close button only when dismissible', async () => {
    auth.providers.value = [{ id: 'google', name: 'Google' }]
    const w = mount(LoginGate, { props: { error: 'Not invited' } })
    expect(w.find('[role=alert]').text()).toBe('Not invited')
    expect(w.find('.close').exists()).toBe(false)
    const d = mount(LoginGate, { props: { dismissible: true } })
    await d.find('.close').trigger('click')
    expect(d.emitted('close')).toHaveLength(1)
  })
})
