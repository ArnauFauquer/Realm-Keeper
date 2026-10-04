// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'

const { post } = vi.hoisted(() => ({ post: vi.fn() }))
vi.mock('@/api/http', () => ({ post }))
vi.mock('@/config/env', () => ({ apiUrl: '' }))

const DocumentModal = (await import('@/components/DocumentModal.vue')).default
const { createModalState } = await import('@/composables/useModalState')
const { DOC_TYPES } = await import('@/utils/docTypes')

const MAP = '/api/asset-library/assets/asset-library/maps/tavern.png'
const chart = (overrides = {}) => ({
  id: 'regions/tavern', name: 'Tavern', description: null, image_url: MAP,
  pins: [{ id: 'p', x: 1, y: 2, name: 'Bar' }], paths: [], annotations: [], updated_at: 'now', ...overrides
})

// A client like api/docs.js's, over a chart or two.
function fakeApi(itemsKey = 'charts') {
  return {
    itemsKey,
    fetchTree: vi.fn().mockResolvedValue({ folders: ['regions'], [itemsKey]: [chart({ id: 'tavern' }), chart({ id: 'bare', name: 'Bare', image_url: null })] }),
    fetchAll: vi.fn().mockResolvedValue([chart()]),
    fetch: vi.fn().mockResolvedValue(chart()),
    save: vi.fn().mockResolvedValue({}),
    setAsset: vi.fn().mockResolvedValue({ image_url: '/api/asset-library/assets/new.png' }),
    create: vi.fn().mockResolvedValue(chart({ id: 'fresh', name: 'Fresh' })),
    remove: vi.fn().mockResolvedValue({}),
    rename: vi.fn().mockResolvedValue({}),
    move: vi.fn().mockResolvedValue({})
  }
}

let api
let modal

// What a wrapper like ChartsModal does with the slot, reduced to what to look at.
function mountModal(kind = DOC_TYPES.chart, { canEdit = true } = {}) {
  const slotProps = {}
  const wrapper = mount(DocumentModal, {
    props: { kind, modal, api, canEdit },
    slots: {
      editor: (props) => {
        Object.assign(slotProps, props)
        return `editing:${props.id}:${props.doc?.name ?? ''}`
      }
    }
  })
  return { wrapper, slotProps }
}

const buttonByText = (wrapper, text) => wrapper.findAll('button').find((b) => b.text().includes(text))

async function openOn(wrapper, id) {
  modal.open(id)
  await flushPromises()
  await nextTick()
}

beforeEach(() => {
  api = fakeApi()
  modal = createModalState()
  post.mockReset().mockResolvedValue({})
  vi.restoreAllMocks()
})

describe('DocumentModal — the gallery', () => {
  it('lists a level, with a thumbnail where the kind has a picture and an icon where it has none', async () => {
    const { wrapper } = mountModal()
    modal.open()
    await flushPromises()
    expect(api.fetchTree).toHaveBeenCalledWith('')
    expect(wrapper.text()).toContain('Tavern')
    const thumbs = wrapper.findAll('.gallery-card-thumb')
    expect(thumbs.map((t) => t.find('img').exists())).toEqual([false, true, false]) // folder, tavern, bare
    expect(thumbs[1].find('img').attributes('src')).toBe(MAP)
    expect(thumbs[2].find('.mdi-map-outline').exists()).toBe(true)
  })

  it('offers to copy a `chart:<id>` reference only for kinds a note can embed', async () => {
    const { wrapper } = mountModal()
    modal.open()
    await flushPromises()
    expect(wrapper.find('[aria-label="Copy reference"]').exists()).toBe(true)

    api = fakeApi('encounters')
    const live = mountModal(DOC_TYPES.encounter)
    modal.close()
    modal.open()
    await flushPromises()
    expect(live.wrapper.find('[aria-label="Copy reference"]').exists()).toBe(false)
  })

  it('words everything from the kind', async () => {
    const { wrapper } = mountModal(DOC_TYPES.vista)
    api.fetchTree.mockResolvedValue({ folders: [], vistas: [] })
    modal.open()
    await flushPromises()
    expect(wrapper.find('[role="dialog"]').attributes('aria-label')).toBe('Vistas')
    expect(wrapper.text()).toContain('No vistas yet')
    expect(wrapper.text()).toContain('New vista')
  })
})

describe('DocumentModal — a document edited whole and saved', () => {
  it('loads the document and hands it to the editor to change in place', async () => {
    const { wrapper, slotProps } = mountModal()
    await openOn(wrapper, 'regions/tavern')
    expect(api.fetch).toHaveBeenCalledWith('regions/tavern')
    expect(wrapper.find('.editor-view').text()).toBe('editing:regions/tavern:Tavern')
    expect(wrapper.find('.modal-header').text()).toContain('Tavern')
    expect(slotProps.doc.pins).toHaveLength(1)
  })

  it('shows it is loading, and what went wrong if it cannot be loaded', async () => {
    let finish
    api.fetch.mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
    const { wrapper } = mountModal()
    modal.open('regions/tavern')
    await nextTick()
    expect(wrapper.text()).toContain('Loading chart')
    finish(chart())
    await flushPromises()
    expect(wrapper.text()).toContain('editing:')

    api.fetch.mockRejectedValueOnce({ response: { data: { detail: 'Chart not found: ghost' } } })
    modal.close()
    await nextTick()
    await openOn(wrapper, 'ghost')
    expect(wrapper.find('.gallery-view').exists()).toBe(true)
    expect(wrapper.text()).toContain('Chart not found: ghost')
  })

  it('saves the name, the description and only the fields its kind edits', async () => {
    const { wrapper, slotProps } = mountModal()
    await openOn(wrapper, 'regions/tavern')
    const save = buttonByText(wrapper, 'Saved')
    expect(save.attributes('disabled')).toBeDefined() // nothing changed

    slotProps.doc.pins.push({ id: 'q', x: 3, y: 4, name: 'Door' })
    slotProps.markDirty()
    await nextTick()
    const dirty = buttonByText(wrapper, 'Save')
    expect(dirty.attributes('disabled')).toBeUndefined()
    await dirty.trigger('click')
    await flushPromises()

    const [id, body] = api.save.mock.calls[0]
    expect(id).toBe('regions/tavern')
    expect(Object.keys(body).sort()).toEqual(['annotations', 'description', 'name', 'paths', 'pins'])
    expect(body.pins.map((p) => p.id)).toEqual(['p', 'q'])
    expect(buttonByText(wrapper, 'Saved')).toBeDefined()
  })

  it('keeps the changes unsaved when saving fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    api.save.mockRejectedValue(new Error('storage down'))
    const { wrapper, slotProps } = mountModal()
    await openOn(wrapper, 'regions/tavern')
    slotProps.markDirty()
    await nextTick()
    await buttonByText(wrapper, 'Save').trigger('click')
    await flushPromises()
    expect(buttonByText(wrapper, 'Save').attributes('disabled')).toBeUndefined()
  })

  it('asks before throwing away unsaved changes, on close and on going back', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { wrapper, slotProps } = mountModal()
    await openOn(wrapper, 'regions/tavern')
    slotProps.markDirty()
    await nextTick()

    await wrapper.find('[aria-label="Close"]').trigger('click')
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('unsaved changes to this chart'))
    expect(modal.isOpen.value).toBe(true)
    await wrapper.find('[aria-label="Back to Charts"]').trigger('click')
    expect(wrapper.find('.editor-view').exists()).toBe(true)

    confirm.mockReturnValue(true)
    await wrapper.find('[aria-label="Close"]').trigger('click')
    expect(modal.isOpen.value).toBe(false)
  })

  it('closes without asking when nothing changed', async () => {
    const confirm = vi.spyOn(window, 'confirm')
    const { wrapper } = mountModal()
    await openOn(wrapper, 'regions/tavern')
    await wrapper.find('[aria-label="Close"]').trigger('click')
    expect(confirm).not.toHaveBeenCalled()
    expect(modal.isOpen.value).toBe(false)
  })

  it("sets its picture through the kind's own route, at once", async () => {
    const { wrapper, slotProps } = mountModal()
    await openOn(wrapper, 'regions/tavern')
    await slotProps.setAsset('image', '/api/asset-library/assets/new.png')
    expect(api.setAsset).toHaveBeenCalledWith('regions/tavern', 'image', '/api/asset-library/assets/new.png')
    expect(slotProps.doc.image_url).toBe('/api/asset-library/assets/new.png')
    expect(buttonByText(wrapper, 'Saved')).toBeDefined() // not something left to Save
  })

  it('copies the reference to paste into a note', async () => {
    const write = vi.fn().mockResolvedValue()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true })
    const { wrapper } = mountModal()
    await openOn(wrapper, 'regions/tavern')
    await buttonByText(wrapper, 'Copy').trigger('click')
    expect(write).toHaveBeenCalledWith('`chart:regions/tavern`')
  })

  it('does not offer saving or the screen to someone who cannot edit', async () => {
    const { wrapper } = mountModal(DOC_TYPES.chart, { canEdit: false })
    await openOn(wrapper, 'regions/tavern')
    expect(buttonByText(wrapper, 'Save')).toBeUndefined()
    expect(buttonByText(wrapper, 'Send to screen')).toBeUndefined()
  })
})

describe('DocumentModal — the table screen', () => {
  it('sends the document that is open to the screen', async () => {
    const { wrapper } = mountModal()
    await openOn(wrapper, 'regions/tavern')
    await buttonByText(wrapper, 'Send to screen').trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledWith('/api/screen/chart', { chart_id: 'regions/tavern' })
  })

  it('has nothing to send until the document has its picture', async () => {
    api.fetch.mockResolvedValue(chart({ image_url: null }))
    const { wrapper } = mountModal()
    await openOn(wrapper, 'regions/tavern')
    expect(buttonByText(wrapper, 'Send to screen').attributes('disabled')).toBeDefined()
    expect(buttonByText(wrapper, 'Go live').attributes('disabled')).toBeDefined()
  })

  it('mirrors unsaved edits while live, shaped as the kind says', async () => {
    vi.useFakeTimers()
    try {
      const { wrapper, slotProps } = mountModal()
      await openOn(wrapper, 'regions/tavern')
      await buttonByText(wrapper, 'Go live').trigger('click')
      await vi.advanceTimersByTimeAsync(200)
      post.mockClear()
      slotProps.doc.pins.push({ id: 'q', x: 3, y: 4, name: 'Door' })
      await vi.advanceTimersByTimeAsync(200)
      const [url, body] = post.mock.calls.at(-1)
      expect(url).toBe('/api/screen/chart/live')
      expect(Object.keys(body).sort()).toEqual(['annotations', 'chart_id', 'image_url', 'paths', 'pins'])
      expect(body.pins).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('puts the saved version back on the screen when closed with edits that were never saved', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { wrapper, slotProps } = mountModal()
    await openOn(wrapper, 'regions/tavern')
    await buttonByText(wrapper, 'Go live').trigger('click')
    await flushPromises()
    slotProps.markDirty()
    post.mockClear()
    await wrapper.find('[aria-label="Close"]').trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledWith('/api/screen/chart', { chart_id: 'regions/tavern' })
  })

  it("sends a vista with its own picture and fields", async () => {
    api = fakeApi('vistas')
    api.fetch.mockResolvedValue({
      id: 'night', name: 'Night', background_url: MAP, vanishing_point: { x: 50, y: 40 }, background_offset_y: 50, assets: [],
    })
    const { wrapper } = mountModal(DOC_TYPES.vista)
    await openOn(wrapper, 'night')
    await buttonByText(wrapper, 'Go live').trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledWith('/api/screen/vista', { vista_id: 'night' })
  })
})

describe('DocumentModal — a live document', () => {
  beforeEach(() => { api = fakeApi('encounters') })

  it('gives the editor the id and nothing to save', async () => {
    const { wrapper } = mountModal(DOC_TYPES.encounter)
    await openOn(wrapper, 'fight')
    expect(api.fetch).not.toHaveBeenCalled() // the editor loads it, live
    expect(wrapper.find('.editor-view').text()).toBe('editing:fight:')
    expect(buttonByText(wrapper, 'Save')).toBeUndefined()
    expect(buttonByText(wrapper, 'Send to screen')).toBeUndefined()
    expect(buttonByText(wrapper, 'Go live')).toBeUndefined()
  })

  it('finds the name of a document opened by id from the listing', async () => {
    api.fetchAll.mockResolvedValue([{ id: 'fight', name: 'The big fight' }])
    const { wrapper } = mountModal(DOC_TYPES.encounter)
    await openOn(wrapper, 'fight')
    expect(wrapper.find('.modal-header').text()).toContain('The big fight')
  })

  it('goes back and closes without asking anything', async () => {
    const confirm = vi.spyOn(window, 'confirm')
    const { wrapper } = mountModal(DOC_TYPES.encounter)
    await openOn(wrapper, 'fight')
    await wrapper.find('[aria-label="Back to Encounters"]').trigger('click')
    expect(wrapper.find('.gallery-view').exists()).toBe(true)
    await wrapper.find('[aria-label="Close"]').trigger('click')
    expect(confirm).not.toHaveBeenCalled()
  })
})

describe('DocumentModal — creating', () => {
  it('opens a new document in its editor', async () => {
    const { wrapper } = mountModal()
    modal.open()
    await flushPromises()
    await buttonByText(wrapper, 'New chart').trigger('click')
    await wrapper.find('input[aria-label="chart name"]').setValue('  Fresh  ')
    await wrapper.find('[aria-label="Create chart"]').trigger('click')
    await flushPromises()
    expect(api.create).toHaveBeenCalledWith('Fresh', '', '')
    expect(api.fetch).toHaveBeenCalledWith('fresh')
    expect(wrapper.find('.editor-view').text()).toContain('editing:fresh:')
  })
})
