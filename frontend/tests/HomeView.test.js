// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

const { get } = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('@/api/http', () => ({ httpClient: { get } }))
vi.mock('@/config/env', () => ({ apiUrl: 'https://api.test' }))

const Home = (await import('@/views/Home.vue')).default
const replace = vi.fn()
const make = () => mount(Home, { global: { mocks: { $router: { replace } } } })

beforeEach(() => {
  get.mockReset()
  replace.mockReset()
  vi.unstubAllEnvs()
})

describe('Home', () => {
  it("opens the note the backend says the vault opens on", async () => {
    get.mockResolvedValue({ data: { note: 'Places/Saltmarsh Docks' } })
    const w = make()
    expect(w.text()).toContain('Loading home page')
    await flushPromises()
    expect(get).toHaveBeenCalledWith('https://api.test/api/home')
    expect(replace).toHaveBeenCalledWith('/note/Places/Saltmarsh%20Docks')
  })

  it('falls back to RealmKeeper when the backend cannot say (older, offline)', async () => {
    get.mockRejectedValue(new Error('offline'))
    make()
    await flushPromises()
    expect(replace).toHaveBeenCalledWith('/note/RealmKeeper')
  })

  it('lets a build pin the default page without asking the backend', async () => {
    vi.stubEnv('VITE_DEFAULT_PAGE', 'Start')
    make()
    await flushPromises()
    expect(get).not.toHaveBeenCalled()
    expect(replace).toHaveBeenCalledWith('/note/Start')
  })

  it('says the vault is empty when there is no note to open', async () => {
    get.mockResolvedValue({ data: { note: null } })
    const w = make()
    await flushPromises()
    expect(replace).not.toHaveBeenCalled()
    expect(w.text()).toContain('The vault has no notes yet')
    expect(w.find('.home-status').exists()).toBe(false)
  })
})
