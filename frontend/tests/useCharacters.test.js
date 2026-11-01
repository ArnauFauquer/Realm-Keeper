import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'

const { commands, docs, statuses, commit, reload, followed } = vi.hoisted(() => ({
  commands: { adjustOwn: vi.fn(), patch: vi.fn() },
  docs: { value: {} },
  statuses: {},
  commit: vi.fn((id, command) => Promise.resolve(command)),
  reload: vi.fn(),
  followed: { ids: null }
}))

vi.mock('@/api/docs', () => ({ charactersApi: { fetch: vi.fn(), commands } }))
vi.mock('@/composables/useSyncedDoc', () => ({
  useSyncedDocs: (kind, ids) => {
    followed.ids = ids
    return { docs: computed(() => docs.value), statusOf: (id) => statuses[id] ?? 'ready', reload, commit }
  }
}))
vi.mock('@/config/env', () => ({ apiUrl: '' }))

const { useCharacters } = await import('@/composables/useCharacters')

const counter = (over = {}) => ({ current: 5, max: 12, min: 0, color: null, style: null, ...over })
const ids = ref(['aria'])
const use = () => useCharacters(() => ids.value)

beforeEach(() => {
  Object.values(commands).forEach((command) => command.mockReset().mockResolvedValue({}))
  commit.mockClear()
  reload.mockClear()
  docs.value = { aria: { id: 'aria', name: 'Aria', resources: { HP: counter() } } }
  for (const key of Object.keys(statuses)) delete statuses[key]
  ids.value = ['aria']
})

describe('useCharacters', () => {
  it('follows one document per character, the ones it is asked for', () => {
    const { stateOf } = use()
    expect(followed.ids()).toEqual(['aria'])
    expect(stateOf('aria').resources.HP.current).toBe(5)
    expect(stateOf('nobody')).toBeNull()
  })

  it('is loading while any of them is', () => {
    const { status } = use()
    expect(status.value).toBe('ready')
    statuses.aria = 'loading'
    ids.value = ['aria', 'bram']
    expect(status.value).toBe('loading')
  })

  it('changes a counter of the character itself', async () => {
    await use().adjust('aria', 'HP', -2)
    expect(commands.adjustOwn).toHaveBeenCalledWith('aria', 'HP', -2)
    expect(commit).toHaveBeenCalledWith('aria', expect.anything())
  })

  it('saves its sheet; the counters follow it on the server', async () => {
    await use().patch('aria', { sheet: { sections: [] } })
    expect(commands.patch).toHaveBeenCalledWith('aria', { sheet: { sections: [] } })
    expect(commit).toHaveBeenCalledWith('aria', expect.anything())
  })
})
