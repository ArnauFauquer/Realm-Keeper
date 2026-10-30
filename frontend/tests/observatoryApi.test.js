// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { client } = vi.hoisted(() => ({
  client: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }
}))
vi.mock('@/api/http', () => ({ httpClient: client }))
vi.mock('@/config/env', () => ({ apiUrl: 'https://api.test' }))

const { observatoryApi: api } = await import('@/api/observatory')
const base = 'https://api.test/api/observatory'

beforeEach(() => {
  Object.values(client).forEach((fn) => fn.mockReset().mockResolvedValue({ data: { ok: 1 } }))
})

describe('the Observatory client', () => {
  it('lists, searches and lists a kind, unwrapping the response data', async () => {
    expect(await api.list()).toEqual({ ok: 1 })
    expect(client.get).toHaveBeenLastCalledWith(base, { params: { path: '' } })
    await api.list('a/b')
    expect(client.get).toHaveBeenLastCalledWith(base, { params: { path: 'a/b' } })
    await api.search('cave')
    expect(client.get).toHaveBeenLastCalledWith(`${base}/search`, { params: { q: 'cave' } })
    await api.listKind('chart')
    expect(client.get).toHaveBeenLastCalledWith(`${base}/all`, { params: { kind: 'chart' } })
  })

  it('manages folders', async () => {
    await api.createFolder('a')
    expect(client.post).toHaveBeenLastCalledWith(`${base}/folders`, { path: 'a' })
    await api.renameFolder('a b/c', 'd')
    expect(client.put).toHaveBeenLastCalledWith(`${base}/folders/a%20b/c`, { name: 'd' })
    await api.removeFolder('a/b')
    expect(client.delete).toHaveBeenLastCalledWith(`${base}/folders/a/b`)
    await api.moveFolder('a', 'b')
    expect(client.post).toHaveBeenLastCalledWith(`${base}/folders/move`, { path: 'a', dest_parent_path: 'b' })
  })

  it('manages images', async () => {
    await api.renameImage('1-a.png', 'b')
    expect(client.post).toHaveBeenLastCalledWith(`${base}/images/rename`, { id: '1-a.png', name: 'b' })
    await api.moveImage('1-a.png', 'f')
    expect(client.post).toHaveBeenLastCalledWith(`${base}/images/move`, { id: '1-a.png', folder_path: 'f' })
    await api.removeImage('1 a.png')
    expect(client.delete).toHaveBeenLastCalledWith(`${base}/images/1%20a.png`)
  })

  it('builds the export URL, with the folder only when there is one', () => {
    expect(api.exportUrl()).toBe(`${base}/export`)
    expect(api.exportUrl('a b')).toBe(`${base}/export?path=a%20b`)
  })

  it('imports files as a form with no time limit', async () => {
    const files = [new File(['1'], 'a.png'), new File(['2'], 'b.png')]
    await api.importFiles('maps', files)
    const [url, form, config] = client.post.mock.calls[0]
    expect(url).toBe(`${base}/import`)
    expect(form.get('path')).toBe('maps')
    expect(form.getAll('files')).toHaveLength(2)
    expect(config).toEqual({ timeout: 0 })
  })
})
