import { beforeEach, describe, expect, it, vi } from 'vitest'

const { client } = vi.hoisted(() => ({
  client: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }
}))
vi.mock('axios', () => ({ default: { create: () => client } }))
vi.mock('@/config/env', () => ({ apiUrl: 'https://api.test' }))

const { chartsApi, vistasApi, encountersApi, charactersApi, docApi } = await import('@/api/docs')

beforeEach(() => {
  Object.values(client).forEach((fn) => fn.mockReset().mockResolvedValue({ data: { ok: true } }))
})

describe('the document clients', () => {
  it('reads and saves a document at a URL that keeps its folders as folders', async () => {
    await chartsApi.fetch('La Biblioteca/la entrada')
    expect(client.get).toHaveBeenLastCalledWith('https://api.test/api/charts/La%20Biblioteca/la%20entrada')
    expect(await chartsApi.save('regions/tavern', { name: 'T', pins: [] })).toEqual({ ok: true })
    expect(client.put).toHaveBeenLastCalledWith('https://api.test/api/charts/regions/tavern', { name: 'T', pins: [] })
  })

  it("sets a picture through the kind's own route", async () => {
    await chartsApi.setAsset('regions/tavern', 'image', '/api/asset-library/assets/m.png')
    expect(client.post).toHaveBeenLastCalledWith(
      'https://api.test/api/charts/regions/tavern/image', { url: '/api/asset-library/assets/m.png' }
    )
    await vistasApi.setAsset('night', 'background', '/api/asset-library/assets/b.png')
    expect(client.post).toHaveBeenLastCalledWith(
      'https://api.test/api/vistas/night/background', { url: '/api/asset-library/assets/b.png' }
    )
  })

  it('lists a level of the tree under the key the kind uses', async () => {
    client.get.mockResolvedValue({ data: { folders: [], charts: [] } })
    expect(await chartsApi.fetchTree('regions')).toEqual({ folders: [], charts: [] })
    expect(client.get).toHaveBeenLastCalledWith('https://api.test/api/charts', { params: { path: 'regions' } })
    expect(chartsApi.itemsKey).toBe('charts')
  })

  it('moves and renames by id, the same way for every kind', async () => {
    await chartsApi.move('tavern', 'regions')
    expect(client.post).toHaveBeenLastCalledWith('https://api.test/api/charts/move', { id: 'tavern', folder_path: 'regions' })
    await vistasApi.rename('night', 'Day')
    expect(client.post).toHaveBeenLastCalledWith('https://api.test/api/vistas/rename', { id: 'night', name: 'Day' })
    await chartsApi.moveFolder('a', 'b')
    expect(client.post).toHaveBeenLastCalledWith('https://api.test/api/charts/folders/move', { path: 'a', dest_parent_path: 'b' })
    await chartsApi.renameFolder('a/b', 'c')
    expect(client.put).toHaveBeenLastCalledWith('https://api.test/api/charts/folders/a/b', { name: 'c' })
    await chartsApi.removeFolder('a/b')
    expect(client.delete).toHaveBeenLastCalledWith('https://api.test/api/charts/folders/a/b')
  })

  it('has the commands live documents are changed with', async () => {
    await encountersApi.commands.adjust('fight', 'combatants', 'orc 1', 'HP', -2)
    expect(client.post).toHaveBeenLastCalledWith(
      'https://api.test/api/encounters/fight/combatants/orc%201/adjust', { resource: 'HP', by: -2 }
    )
    await charactersApi.commands.adjustOwn('aria', 'HP', 3)
    expect(client.post).toHaveBeenLastCalledWith('https://api.test/api/characters/aria/adjust', { resource: 'HP', by: 3 })
    await charactersApi.ensure('aria', { name: 'Aria' })
    expect(client.post).toHaveBeenLastCalledWith('https://api.test/api/characters/ensure', { id: 'aria', fields: { name: 'Aria' } })
    await charactersApi.reassign('aria', 'aria-la-roja')
    expect(client.post).toHaveBeenLastCalledWith('https://api.test/api/characters/aria/reassign', { id: 'aria-la-roja' })
  })

  it('gives the client of a kind by its name', () => {
    expect(docApi('chart')).toBe(chartsApi)
    expect(docApi('vista')).toBe(vistasApi)
  })
})
