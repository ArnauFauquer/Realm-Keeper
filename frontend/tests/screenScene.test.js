import { describe, expect, it } from 'vitest'
import { EMPTY_SCENE, changesScene, reduceScene, screenMediaUrl } from '@/utils/screenScene'

const run = (...messages) => messages.reduce(reduceScene, EMPTY_SCENE)
const loaded = (state, doc) => reduceScene(state, { type: 'scene_loaded', seq: state.seq, doc })

describe('reduceScene', () => {
  it('shows an image with its caption', () => {
    const state = run({ type: 'display_media', url: '/a.png', title: 'Harbour' })
    expect(state).toMatchObject({ kind: 'media', url: '/a.png', title: 'Harbour' })
  })

  it('keeps the image up when a media message carries no url', () => {
    const shown = run({ type: 'display_media', url: '/a.png', title: 'Harbour' })
    expect(reduceScene(shown, { type: 'display_media' })).toBe(shown)
    expect(run({ type: 'display_chart', chart_id: 'c' }, { type: 'display_media' }).kind).toBe('none')
  })

  it('drops the image caption when a chart is sent', () => {
    const state = run({ type: 'display_media', url: '/a.png', title: 'Harbour' }, { type: 'display_chart', chart_id: 'map' })
    expect(state).toMatchObject({ kind: 'chart', id: 'map', loading: true, url: '', title: '', doc: null })
  })

  it('takes a fetched chart only while its scene is the one showing', () => {
    const asked = run({ type: 'display_chart', chart_id: 'a' })
    const replaced = reduceScene(asked, { type: 'display_chart', chart_id: 'b' })
    // A's fetch resolves after B was sent: ignored.
    expect(reduceScene(replaced, { type: 'scene_loaded', seq: asked.seq, doc: { id: 'a' } })).toBe(replaced)
    expect(loaded(replaced, { id: 'b' })).toMatchObject({ kind: 'chart', doc: { id: 'b' }, loading: false })
  })

  it('a slow chart fetch can not hide an image sent after it', () => {
    const asked = run({ type: 'display_chart', chart_id: 'a' })
    const image = reduceScene(asked, { type: 'display_media', url: '/b.png' })
    expect(reduceScene(image, { type: 'scene_loaded', seq: asked.seq, doc: { id: 'a' } })).toBe(image)
    expect(reduceScene(image, { type: 'scene_failed', seq: asked.seq })).toBe(image)
  })

  it('keeps the chart on screen while the next chart loads', () => {
    const first = loaded(run({ type: 'display_chart', chart_id: 'a' }), { id: 'a', pins: [] })
    const next = reduceScene(first, { type: 'display_chart', chart_id: 'b' })
    expect(next.doc).toEqual({ id: 'a', pins: [] })
    expect(next.loading).toBe(true)
    // Not from one kind to another.
    expect(reduceScene(first, { type: 'display_vista', vista_id: 'v' }).doc).toBeNull()
  })

  it('shows nothing when a fetch fails', () => {
    const asked = run({ type: 'display_vista', vista_id: 'v' })
    expect(reduceScene(asked, { type: 'scene_failed', seq: asked.seq })).toMatchObject({ kind: 'vista', doc: null, loading: false })
  })

  it('patches the chart on screen with live edits', () => {
    const shown = loaded(run({ type: 'display_chart', chart_id: 'a' }), { id: 'a', name: 'Old', pins: [] })
    const edited = reduceScene(shown, { type: 'update_chart', chart_id: 'a', pins: [{ id: 'p' }] })
    expect(edited.doc).toEqual({ id: 'a', name: 'Old', chart_id: 'a', pins: [{ id: 'p' }] })
    expect(shown.doc.pins).toEqual([])
  })

  it('holds a live edit that beats its fetch, then lays it over the saved version', () => {
    const asked = run({ type: 'display_vista', vista_id: 'v' }, { type: 'update_vista', vista_id: 'v', assets: [1] })
    expect(asked.pendingLiveEdit).toEqual({ kind: 'vista', edit: { vista_id: 'v', assets: [1] } })
    const state = loaded(asked, { id: 'v', assets: [], name: 'Night' })
    expect(state.doc).toEqual({ id: 'v', vista_id: 'v', assets: [1], name: 'Night' })
    expect(state.pendingLiveEdit).toBeNull()
  })

  it('does not lay a live edit for another document over the one fetched', () => {
    const asked = run({ type: 'display_chart', chart_id: 'a' }, { type: 'update_chart', chart_id: 'z', name: 'Z' })
    expect(loaded(asked, { id: 'a', name: 'A' }).doc).toEqual({ id: 'a', name: 'A' })
  })

  it('forgets a pending live edit when the scene changes', () => {
    const state = run({ type: 'display_chart', chart_id: 'a' }, { type: 'update_chart', chart_id: 'a', name: 'A' }, { type: 'clear_screen' })
    expect(state.pendingLiveEdit).toBeNull()
  })

  it('shows a battlemap once its projection arrives, and only its own', () => {
    let state = run({ type: 'display_battlemap', battlemap_id: 'cave' })
    expect(state).toMatchObject({ kind: 'battlemap', id: 'cave', battlemap: null })
    expect(reduceScene(state, { type: 'update_battlemap', battlemap_id: 'other', tokens: [] })).toBe(state)
    state = reduceScene(state, { type: 'update_battlemap', battlemap_id: 'cave', tokens: [] })
    expect(state.battlemap).toEqual({ battlemap_id: 'cave', tokens: [] })
    expect(reduceScene(run({ type: 'clear_screen' }), { type: 'update_battlemap', battlemap_id: 'cave' }).kind).toBe('none')
  })

  it('restarts the constellation each time it is sent and only patches it while it shows', () => {
    const first = run({ type: 'display_constellation', highlights: [] })
    const again = reduceScene(first, { type: 'display_constellation', highlights: ['a'] })
    expect(again.seq).toBeGreaterThan(first.seq)
    expect(reduceScene(again, { type: 'update_constellation', zoom: 2 }).constellation).toEqual({ zoom: 2 })
    const cleared = reduceScene(again, { type: 'clear_screen' })
    expect(reduceScene(cleared, { type: 'update_constellation', zoom: 2 })).toBe(cleared)
  })

  it('leaves the scene alone for a dice roll or an unknown message', () => {
    const shown = run({ type: 'display_media', url: '/a.png' })
    expect(reduceScene(shown, { type: 'dice_roll', total: 4 })).toBe(shown)
    expect(reduceScene(shown, { type: 'something_new' })).toBe(shown)
  })

  it('clears everything on clear_screen', () => {
    const state = run({ type: 'display_media', url: '/a.png', title: 'Harbour' }, { type: 'clear_screen' })
    expect(state).toEqual({ ...EMPTY_SCENE, seq: 2 })
  })
})

describe('changesScene', () => {
  it('is true for the messages that put a new scene up', () => {
    expect(changesScene({ type: 'display_chart' })).toBe(true)
    expect(changesScene({ type: 'clear_screen' })).toBe(true)
    expect(changesScene({ type: 'update_battlemap' })).toBe(false)
    expect(changesScene({ type: 'dice_roll' })).toBe(false)
  })
})

describe('screenMediaUrl', () => {
  it('points a localhost url at the address the screen is on', () => {
    expect(screenMediaUrl('http://localhost:8000/api/x.png', '192.168.1.20')).toBe('http://192.168.1.20:8000/api/x.png')
    expect(screenMediaUrl('http://localhost:8000/api/x.png', 'localhost')).toBe('http://localhost:8000/api/x.png')
    expect(screenMediaUrl('/api/x.png', '192.168.1.20')).toBe('/api/x.png')
  })
})
