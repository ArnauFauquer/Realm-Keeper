// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

vi.mock('@/config/env', () => ({ apiUrl: '' }))

const BattlemapSignals = (await import('@/components/BattlemapSignals.vue')).default

const GRID = { type: 'square', size: 70, offset_x: 0, offset_y: 0 }
const TOKEN = { id: 't1', name: 'Orc', x: 1, y: 1, size: 1, image_url: '/api/observatory/images/1a2b3c4d-orc.png' }

// A layer showing one ruler: someone moving the Orc, as the screen hears it.
function layerWith(rulers) {
  const view = { pings: [], strokes: [], rolls: [], rulers }
  return { prune: () => {}, view: () => view, idle: () => true, subscribe: () => () => {} }
}

describe('BattlemapSignals', () => {
  it("clips the picture of a token someone else is moving to the token, whoever they are", async () => {
    vi.stubGlobal('requestAnimationFrame', (fn) => { fn(); return 1 })
    const ruler = { key: 'abc|Local User|3', color: '#fff', by: 'Local User', token: 't1', points: [{ x: 1.5, y: 1.5 }, { x: 4.5, y: 1.5 }], ended: false, opacity: 1 }
    const wrapper = mount(BattlemapSignals, {
      props: { layer: layerWith([ruler]), grid: GRID, tokens: [TOKEN] },
      attachTo: document.body
    })
    await wrapper.vm.$nextTick()
    const clip = wrapper.find('clipPath')
    const id = clip.attributes('id')
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/) // an id url(#…) can find: no spaces, no bars
    expect(wrapper.find('[clip-path]').attributes('clip-path')).toBe(`url(#${id})`)
    wrapper.unmount()
    vi.unstubAllGlobals()
  })
})
