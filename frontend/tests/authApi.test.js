// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { client } = vi.hoisted(() => ({ client: { get: vi.fn(), post: vi.fn() } }))
vi.mock('@/api/http', () => ({ httpClient: client }))
vi.mock('@/config/env', () => ({ apiUrl: 'https://api.test' }))

const { getCurrentUser, logout, loginUrl, getAuthProviders } = await import('@/api/auth')

beforeEach(() => {
  client.get.mockReset().mockResolvedValue({ data: { email: 'gm@example.com' } })
  client.post.mockReset().mockResolvedValue({ data: {} })
})

describe('the auth client', () => {
  it('asks who is signed in', async () => {
    expect(await getCurrentUser()).toEqual({ email: 'gm@example.com' })
    expect(client.get).toHaveBeenCalledWith('https://api.test/api/auth/me')
  })

  it('signs out with an empty body', async () => {
    await logout()
    expect(client.post).toHaveBeenCalledWith('https://api.test/api/auth/logout', {})
  })

  it('builds the login URL, naming the provider only when there is one', () => {
    expect(loginUrl()).toBe('https://api.test/api/auth/login')
    expect(loginUrl('github')).toBe('https://api.test/api/auth/login?provider=github')
    expect(loginUrl('a b&c')).toBe('https://api.test/api/auth/login?provider=a%20b%26c')
  })

  it('lists the providers', async () => {
    client.get.mockResolvedValue({ data: { providers: [{ id: 'google' }] } })
    expect(await getAuthProviders()).toEqual({ providers: [{ id: 'google' }] })
    expect(client.get).toHaveBeenCalledWith('https://api.test/api/auth/providers')
  })
})
