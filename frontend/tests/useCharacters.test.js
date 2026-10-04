import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'

const { commands, ensure, docs, statuses, commit, reload, followed } = vi.hoisted(() => ({
  commands: { adjustOwn: vi.fn(), patch: vi.fn() },
  ensure: vi.fn(),
  docs: { value: {} },
  statuses: {},
  commit: vi.fn((id, command) => Promise.resolve(command)),
  reload: vi.fn(),
  followed: { ids: null }
}))

vi.mock('@/api/docs', () => ({ charactersApi: { fetch: vi.fn(), ensure, commands } }))
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
  ensure.mockReset().mockResolvedValue({ created: true })
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

  it('saves a character from its sheet under the sheet id, and loads it once made', async () => {
    await use().ensure({ id: 'aria', name: 'Aria', resources: { HP: { max: 12 }, Hope: { max: 6, start: 2 } } })
    expect(ensure).toHaveBeenCalledWith('aria', {
      name: 'Aria', resources: { HP: counter({ current: 12 }), Hope: counter({ current: 2, max: 6 }) }
    })
    expect(reload).toHaveBeenCalledWith('aria')

    ensure.mockResolvedValue({ created: false })
    reload.mockClear()
    await use().ensure({ id: 'aria', name: 'Aria', resources: {} })
    expect(reload).not.toHaveBeenCalled()                     // it was there already
  })

  it('changes a counter of the character itself', async () => {
    await use().adjust('aria', 'HP', -2)
    expect(commands.adjustOwn).toHaveBeenCalledWith('aria', 'HP', -2)
    expect(commit).toHaveBeenCalledWith('aria', expect.anything())
  })

  describe('reconcile', () => {
    it('does nothing when the sheet and the saved values agree, or there are none yet', async () => {
      const { reconcile } = use()
      expect(await reconcile({ id: 'aria', name: 'Aria', resources: { HP: { max: 12 } } })).toBeNull()
      expect(await reconcile({ id: 'nobody', name: 'X', resources: { HP: { max: 12 } } })).toBeNull()
      expect(commands.patch).not.toHaveBeenCalled()
    })

    it('takes what changed in the sheet and keeps the current value within its new range', async () => {
      await use().reconcile({ id: 'aria', name: 'Aria', resources: { HP: { max: 4, color: 'red' } } })
      expect(commands.patch).toHaveBeenCalledWith('aria', {
        resources: { HP: { max: 4, min: 0, color: 'red', style: null, current: 4 } }
      })
    })

    it('adds a counter the sheet gained, and leaves the others alone', async () => {
      await use().reconcile({ id: 'aria', name: 'Aria', resources: { HP: { max: 12 }, Mana: { max: 3, start: 1 } } })
      expect(commands.patch).toHaveBeenCalledWith('aria', { resources: { Mana: counter({ current: 1, max: 3 }) } })
    })

    it('follows the sheet when it is renamed', async () => {
      await use().reconcile({ id: 'aria', name: 'Aria la Roja', resources: { HP: { max: 12 } } })
      expect(commands.patch).toHaveBeenCalledWith('aria', { name: 'Aria la Roja' })
    })
  })
})
