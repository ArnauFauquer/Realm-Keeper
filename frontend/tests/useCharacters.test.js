import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

const { commands, doc, commit } = vi.hoisted(() => ({
  commands: { addItems: vi.fn(), adjust: vi.fn(), patchItem: vi.fn() },
  doc: { value: null },
  commit: vi.fn((command) => Promise.resolve(command))
}))

vi.mock('@/api/docs', () => ({ charactersApi: { fetch: vi.fn(), commands } }))
vi.mock('@/composables/useSyncedDoc', () => ({ useSyncedDoc: () => ({ doc, status: ref('ready'), commit }) }))
vi.mock('@/config/env', () => ({ apiUrl: '' }))

const { useCharacters } = await import('@/composables/useCharacters')

const saved = (resources) => ({ characters: [{ id: 'aria', resources }] })
const counter = (over = {}) => ({ current: 5, max: 12, min: 0, color: null, style: null, ...over })

beforeEach(() => {
  Object.values(commands).forEach((command) => command.mockReset().mockResolvedValue({}))
  commit.mockClear()
  doc.value = saved({ HP: counter() })
})

describe('useCharacters', () => {
  it('finds a character\'s state by its sheet id', () => {
    const { stateOf } = useCharacters()
    expect(stateOf('aria').resources.HP.current).toBe(5)
    expect(stateOf('nobody')).toBeNull()
    doc.value = null
    expect(stateOf('aria')).toBeNull()
  })

  it('creates a state from the sheet, harmlessly if it exists', async () => {
    await useCharacters().ensure({ id: 'aria', resources: { HP: { max: 12 }, Hope: { max: 6, start: 2 } } })
    expect(commands.addItems).toHaveBeenCalledWith(
      null, 'characters',
      [{ id: 'aria', resources: { HP: counter({ current: 12 }), Hope: counter({ current: 2, max: 6 }) } }],
      { ignoreExisting: true }
    )
    expect(commit).toHaveBeenCalled()
  })

  it('asks the server to change a counter', async () => {
    await useCharacters().adjust('aria', 'HP', -2)
    expect(commands.adjust).toHaveBeenCalledWith(null, 'characters', 'aria', 'HP', -2)
  })

  describe('reconcile', () => {
    it('does nothing when the sheet and the saved counters agree, or there are none yet', async () => {
      const { reconcile } = useCharacters()
      expect(await reconcile({ id: 'aria', resources: { HP: { max: 12 } } })).toBeNull()
      expect(await reconcile({ id: 'nobody', resources: { HP: { max: 12 } } })).toBeNull()
      expect(commands.patchItem).not.toHaveBeenCalled()
    })

    it('takes what changed in the sheet and keeps the current value within its new range', async () => {
      await useCharacters().reconcile({ id: 'aria', resources: { HP: { max: 4, color: 'red' } } })
      expect(commands.patchItem).toHaveBeenCalledWith(null, 'characters', 'aria', {
        resources: { HP: { max: 4, min: 0, color: 'red', style: null, current: 4 } }
      })
    })

    it('adds a counter the sheet gained, and leaves the others alone', async () => {
      await useCharacters().reconcile({ id: 'aria', resources: { HP: { max: 12 }, Mana: { max: 3, start: 1 } } })
      expect(commands.patchItem).toHaveBeenCalledWith(null, 'characters', 'aria', {
        resources: { Mana: counter({ current: 1, max: 3 }) }
      })
    })
  })
})
