// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { post } = vi.hoisted(() => ({ post: vi.fn() }))
vi.mock('@/api/http', () => ({ post }))
vi.mock('@/config/env', () => ({ apiUrl: 'https://api.test' }))

const { createScreenLink, pairScreen, screenApi } = await import('@/api/screen')
const base = 'https://api.test/api/screen'

beforeEach(() => { post.mockReset().mockResolvedValue({}) })

describe('the screen client', () => {
  it('makes a link with the key in the fragment, so it never reaches a server log', async () => {
    post.mockResolvedValue({ key: 'a b/c' })
    const url = await createScreenLink()
    expect(post).toHaveBeenCalledWith(`${base}/link`)
    expect(url).toBe(`${window.location.origin}/screen#key=a%20b%2Fc`)
    expect(new URL(url).search).toBe('')
  })

  it('trades the key for a pairing cookie', async () => {
    await pairScreen('k')
    expect(post).toHaveBeenCalledWith(`${base}/pair`, { key: 'k' })
  })

  it('sends each kind of content to its own route', async () => {
    await screenApi.display('/i.png', 'Cave')
    expect(post).toHaveBeenLastCalledWith(`${base}/display`, { url: '/i.png', title: 'Cave' })
    await screenApi.dice({ total: 7 })
    expect(post).toHaveBeenLastCalledWith(`${base}/dice`, { total: 7 })
    await screenApi.clear()
    expect(post).toHaveBeenLastCalledWith(`${base}/clear`, {})
    await screenApi.chart('c1')
    expect(post).toHaveBeenLastCalledWith(`${base}/chart`, { chart_id: 'c1' })
    await screenApi.vista('v1')
    expect(post).toHaveBeenLastCalledWith(`${base}/vista`, { vista_id: 'v1' })
    await screenApi.battlemap('b1')
    expect(post).toHaveBeenLastCalledWith(`${base}/battlemap`, { battlemap_id: 'b1' })
    await screenApi.battlemapView('b1', { x: 1 })
    expect(post).toHaveBeenLastCalledWith(`${base}/battlemap/view`, { battlemap_id: 'b1', view: { x: 1 } })
    await screenApi.show('constellation', { a: 1 })
    expect(post).toHaveBeenLastCalledWith(`${base}/constellation`, { a: 1 })
    await screenApi.live('chart', { pins: [] })
    expect(post).toHaveBeenLastCalledWith(`${base}/chart/live`, { pins: [] })
  })
})
