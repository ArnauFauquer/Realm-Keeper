// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  getCurrentUser: vi.fn(), getAuthProviders: vi.fn(), logout: vi.fn(),
  loginUrl: vi.fn((p) => `/login?p=${p}`)
}))
vi.mock('@/api/auth', () => api)

let auth
beforeEach(async () => {
  vi.resetModules()
  Object.values(api).forEach((fn) => fn.mockReset())
  api.loginUrl.mockImplementation((p) => `/login?p=${p}`)
  vi.unstubAllGlobals()
  auth = (await import('@/composables/useAuth')).useAuth()
})

afterEach(() => { vi.unstubAllGlobals() })

describe('checkAuth', () => {
  it('stores the user and marks the check done', async () => {
    api.getCurrentUser.mockResolvedValue({ email: 'a@b.c' })
    await auth.checkAuth()
    expect(auth.user.value).toEqual({ email: 'a@b.c' })
    expect(auth.loading.value).toBe(false)
    expect(auth.checked.value).toBe(true)
  })

  it('treats a failure as signed out', async () => {
    api.getCurrentUser.mockRejectedValue(new Error('401'))
    await auth.checkAuth()
    expect(auth.user.value).toBeNull()
    expect(auth.checked.value).toBe(true)
  })
})

describe('loadProviders', () => {
  it('loads once and keeps the list', async () => {
    api.getAuthProviders.mockResolvedValue({ providers: [{ id: 'github' }] })
    expect(await auth.loadProviders()).toEqual([{ id: 'github' }])
    await auth.loadProviders()
    expect(api.getAuthProviders).toHaveBeenCalledTimes(1)
  })

  it('falls back to Google when the backend has no list', async () => {
    api.getAuthProviders.mockRejectedValue(new Error('404'))
    expect(await auth.loadProviders()).toEqual([{ id: 'google', name: 'Google' }])
  })

  it('treats an answer without providers as none', async () => {
    api.getAuthProviders.mockResolvedValue({})
    expect(await auth.loadProviders()).toEqual([])
  })
})

describe('login', () => {
  beforeEach(() => {
    vi.stubGlobal('location', { href: '' })
  })

  it('goes to the named provider', async () => {
    await auth.login('github')
    expect(window.location.href).toBe('/login?p=github')
    expect(api.getAuthProviders).not.toHaveBeenCalled()
  })

  it('goes straight to the only provider', async () => {
    api.getAuthProviders.mockResolvedValue({ providers: [{ id: 'google' }] })
    await auth.login()
    expect(window.location.href).toBe('/login?p=google')
  })

  it('opens the gate to pick when there are several', async () => {
    api.getAuthProviders.mockResolvedValue({ providers: [{ id: 'a' }, { id: 'b' }] })
    await auth.login()
    expect(auth.choosingProvider.value).toBe(true)
    expect(window.location.href).toBe('')
  })

  it('ignores a click event passed as the provider', async () => {
    api.getAuthProviders.mockResolvedValue({ providers: [{ id: 'only' }] })
    await auth.login(new Event('click'))
    expect(window.location.href).toBe('/login?p=only')
  })
})

describe('logout', () => {
  it('signs out and drops only the cached API responses', async () => {
    api.logout.mockResolvedValue()
    auth.user.value = { email: 'a' }
    const del = vi.fn()
    const requests = [{ url: 'https://x.test/api/notes' }, { url: 'https://x.test/assets/a.js' }]
    vi.stubGlobal('caches', {
      keys: async () => ['v1'],
      open: async () => ({ keys: async () => requests, delete: del })
    })
    await auth.logout()
    expect(auth.user.value).toBeNull()
    expect(del).toHaveBeenCalledTimes(1)
    expect(del).toHaveBeenCalledWith(requests[0])
  })

  it('survives Cache Storage being unavailable', async () => {
    api.logout.mockResolvedValue()
    vi.stubGlobal('caches', { keys: async () => { throw new Error('blocked') } })
    await expect(auth.logout()).resolves.toBeUndefined()
    vi.stubGlobal('caches', undefined)
    await expect(auth.logout()).resolves.toBeUndefined()
  })
})
