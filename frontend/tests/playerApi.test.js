// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { client } = vi.hoisted(() => ({
  client: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }
}))
vi.mock('@/api/http', () => ({ httpClient: client }))
vi.mock('@/config/env', () => ({ apiUrl: 'https://api.test' }))

const api = await import('@/api/player')
const base = 'https://api.test/api/player'

beforeEach(() => {
  Object.values(client).forEach((fn) => fn.mockReset().mockResolvedValue({ data: {} }))
})

describe('the player client', () => {
  it('lists albums and tracks', async () => {
    client.get.mockResolvedValueOnce({ data: { albums: ['a'] } })
    expect(await api.fetchAlbums()).toEqual(['a'])
    client.get.mockResolvedValueOnce({ data: { tracks: [{ key: 'k' }] } })
    expect(await api.fetchTracks('Epic Music')).toEqual([{ key: 'k' }])
    expect(client.get).toHaveBeenLastCalledWith(`${base}/albums/Epic%20Music/tracks`)
  })

  it('creates, renames and deletes albums with encoded names', async () => {
    await api.createAlbum('Rain')
    expect(client.post).toHaveBeenCalledWith(`${base}/albums`, { name: 'Rain' })
    await api.renameAlbum('a/b', 'c')
    expect(client.put).toHaveBeenCalledWith(`${base}/albums/a%2Fb`, { name: 'c' })
    await api.deleteAlbum('x y')
    expect(client.delete).toHaveBeenCalledWith(`${base}/albums/x%20y`)
  })

  it('uploads a track as a form without a time limit and reports progress as a fraction', async () => {
    const file = new File(['x'], 'song.mp3')
    const onProgress = vi.fn()
    await api.uploadTrack('Rain', file, onProgress)
    const [url, form, config] = client.post.mock.calls[0]
    expect(url).toBe(`${base}/albums/Rain/tracks`)
    expect(form.get('file')).toBeInstanceOf(File)
    expect(config.timeout).toBe(0)
    config.onUploadProgress({ loaded: 1, total: 4 })
    config.onUploadProgress({ loaded: 1 })
    expect(onProgress.mock.calls).toEqual([[0.25], [0]])
  })

  it('does not wire a progress handler when nobody listens', async () => {
    await api.uploadTrack('Rain', new File(['x'], 's.mp3'))
    expect(client.post.mock.calls[0][2].onUploadProgress).toBeUndefined()
  })

  it('deletes, moves, renames and streams a track by key', async () => {
    await api.deleteTrack('Rain/a b.mp3')
    expect(client.delete).toHaveBeenCalledWith(`${base}/tracks/Rain/a%20b.mp3`)
    client.post.mockResolvedValue({ data: { key: 'new' } })
    expect(await api.moveTrack('k', 'Alb')).toEqual({ key: 'new' })
    expect(client.post).toHaveBeenLastCalledWith(`${base}/tracks/move`, { key: 'k', album: 'Alb' })
    expect(await api.renameTrack('k', 'n')).toEqual({ key: 'new' })
    expect(client.post).toHaveBeenLastCalledWith(`${base}/tracks/rename`, { key: 'k', name: 'n' })
    expect(api.streamUrl('Rain/a b.mp3')).toBe(`${base}/stream/Rain/a%20b.mp3`)
  })
})
