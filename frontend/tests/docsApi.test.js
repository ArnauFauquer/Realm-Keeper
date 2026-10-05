import { beforeEach, describe, expect, it, vi } from 'vitest'

const { client } = vi.hoisted(() => ({
  client: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }
}))
// Every client goes through the app's one HTTP client (api/http.js).
vi.mock('@/api/http', () => ({ httpClient: client }))
vi.mock('@/config/env', () => ({ apiUrl: 'https://api.test' }))

const { chartsApi, vistasApi, encountersApi, charactersApi, docApi } = await import('@/api/docs')
const { observatoryApi } = await import('@/api/observatory')

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
    await chartsApi.setAsset('regions/tavern', 'image', '/api/observatory/images/1a2b3c4d-m.png')
    expect(client.post).toHaveBeenLastCalledWith(
      'https://api.test/api/charts/regions/tavern/image', { url: '/api/observatory/images/1a2b3c4d-m.png' }
    )
    await vistasApi.setAsset('night', 'background', '/api/observatory/images/1a2b3c4d-b.png')
    expect(client.post).toHaveBeenLastCalledWith(
      'https://api.test/api/vistas/night/background', { url: '/api/observatory/images/1a2b3c4d-b.png' }
    )
  })

  it('lists every document of a kind under the key the kind uses', async () => {
    client.get.mockResolvedValue({ data: { charts: [{ id: 'tavern' }] } })
    expect(await chartsApi.fetchAll()).toEqual([{ id: 'tavern' }])
    expect(client.get).toHaveBeenLastCalledWith('https://api.test/api/charts/all')
    expect(chartsApi.itemsKey).toBe('charts')
  })

  it('moves and renames by id, the same way for every kind', async () => {
    await chartsApi.move('tavern', 'regions')
    expect(client.post).toHaveBeenLastCalledWith('https://api.test/api/charts/move', { id: 'tavern', folder_path: 'regions' })
    await vistasApi.rename('night', 'Day')
    expect(client.post).toHaveBeenLastCalledWith('https://api.test/api/vistas/rename', { id: 'night', name: 'Day' })
  })

  it('has the commands live documents are changed with', async () => {
    await encountersApi.commands.adjust('fight', 'combatants', 'orc 1', 'HP', -2)
    expect(client.post).toHaveBeenLastCalledWith(
      'https://api.test/api/encounters/fight/combatants/orc%201/adjust', { resource: 'HP', by: -2 }
    )
    await charactersApi.commands.adjustOwn('aria', 'HP', 3)
    expect(client.post).toHaveBeenLastCalledWith('https://api.test/api/characters/aria/adjust', { resource: 'HP', by: 3 })
  })

  it('gives the client of a kind by its name', () => {
    expect(docApi('chart')).toBe(chartsApi)
    expect(docApi('vista')).toBe(vistasApi)
    expect(docApi('adversary').base).toBe('https://api.test/api/adversaries')
  })
})

describe('the Observatory client', () => {
  it('lists a folder, and keeps the folders of a path as folders in the URL', async () => {
    client.get.mockResolvedValue({ data: { folders: ['maps'], items: [] } })
    expect(await observatoryApi.list('act 2')).toEqual({ folders: ['maps'], items: [] })
    expect(client.get).toHaveBeenLastCalledWith('https://api.test/api/observatory', { params: { path: 'act 2' } })
    await observatoryApi.renameFolder('act 2/caves', 'Caves')
    expect(client.put).toHaveBeenLastCalledWith('https://api.test/api/observatory/folders/act%202/caves', { name: 'Caves' })
    await observatoryApi.moveFolder('a', 'b')
    expect(client.post).toHaveBeenLastCalledWith('https://api.test/api/observatory/folders/move', { path: 'a', dest_parent_path: 'b' })
    await observatoryApi.removeFolder('a/b')
    expect(client.delete).toHaveBeenLastCalledWith('https://api.test/api/observatory/folders/a/b')
  })

  it('names an image by its file name, a single part of the URL', async () => {
    await observatoryApi.removeImage('1a2b3c4d-cave map.png')
    expect(client.delete).toHaveBeenLastCalledWith('https://api.test/api/observatory/images/1a2b3c4d-cave%20map.png')
    await observatoryApi.moveImage('1a2b3c4d-cave.png', 'act 2')
    expect(client.post).toHaveBeenLastCalledWith('https://api.test/api/observatory/images/move', { id: '1a2b3c4d-cave.png', folder_path: 'act 2' })
    await observatoryApi.importFiles('act 2', [new File(['x'], 'a.png'), new File(['{}'], 'b.chart.json')])
    const [url, form] = client.post.mock.calls.at(-1)
    expect(url).toBe('https://api.test/api/observatory/import')
    expect(form.get('path')).toBe('act 2')
    expect(form.getAll('files').map((f) => f.name)).toEqual(['a.png', 'b.chart.json'])
  })

  it('downloads a backup of a folder, or of everything', () => {
    expect(observatoryApi.exportUrl()).toBe('https://api.test/api/observatory/export')
    expect(observatoryApi.exportUrl('act 2')).toBe('https://api.test/api/observatory/export?path=act%202')
  })
})
