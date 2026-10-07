// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'

const { post } = vi.hoisted(() => ({ post: vi.fn() }))
vi.mock('@/api/http', async (importOriginal) => ({ ...(await importOriginal()), post }))
vi.mock('@/config/env', () => ({ apiUrl: '' }))
// A live document as useSyncedDoc shares it: whatever id the modal follows,
// with the copy `liveDocs` holds for it.
const { liveDocs, followed } = vi.hoisted(() => ({ liveDocs: {}, followed: [] }))
vi.mock('@/composables/useSyncedDoc', async () => {
  const { computed: c, ref: r, watch: w } = await import('vue')
  return {
    useSyncedDocFollowing: (kind, id) => {
      const current = r(null)
      w(id, (wanted) => { current.value = wanted; if (wanted) followed.push(`${kind}:${wanted}`) }, { immediate: true })
      return { doc: c(() => (current.value ? liveDocs[current.value]?.value ?? null : null)), status: c(() => 'ready') }
    }
  }
})

const DocumentModal = (await import('@/components/DocumentModal.vue')).default
const { createModalState } = await import('@/composables/useModalState')
const { useObservatoryModal } = await import('@/composables/useObservatoryModal')
const { DOC_TYPES } = await import('@/utils/docTypes')

const MAP = '/api/observatory/images/1a2b3c4d-tavern.png'
const chart = (overrides = {}) => ({
  id: 'regions/tavern', name: 'Tavern', description: null, image_url: MAP,
  pins: [{ id: 'p', x: 1, y: 2, name: 'Bar' }], paths: [], annotations: [], updated_at: 'now', ...overrides
})

// A client like api/docs.js's, over a chart or two.
function fakeApi(itemsKey = 'charts') {
  return {
    itemsKey,
    fetchAll: vi.fn().mockResolvedValue([chart()]),
    fetch: vi.fn().mockResolvedValue(chart()),
    save: vi.fn().mockResolvedValue({}),
    setAsset: vi.fn().mockResolvedValue({ image_url: '/api/observatory/images/1a2b3c4d-new.png' })
  }
}

let api
let modal
const observatory = useObservatoryModal()

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
  for (const key of Object.keys(liveDocs)) delete liveDocs[key]
  followed.length = 0
  api = fakeApi()
  modal = createModalState()
  observatory.close()
  observatory.targetId.value = null
  post.mockReset().mockResolvedValue({})
  vi.restoreAllMocks()
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
    expect(wrapper.find('.load-error').text()).toContain('Chart not found: ghost')
    expect(wrapper.find('.editor-view').exists()).toBe(false)
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
    expect(Object.keys(body).sort()).toEqual(['annotations', 'base_updated_at', 'description', 'name', 'paths', 'pins'])
    expect(body.pins.map((p) => p.id)).toEqual(['p', 'q'])
    expect(buttonByText(wrapper, 'Saved')).toBeDefined()
  })

  it('says when the document changed elsewhere, and a second Save overwrites it', async () => {
    api.save.mockRejectedValueOnce({ message: 'x', response: { status: 409, data: { detail: 'changed' } } })
    const { wrapper, slotProps } = mountModal()
    await openOn(wrapper, 'regions/tavern')
    slotProps.markDirty()
    await nextTick()
    await buttonByText(wrapper, 'Save').trigger('click')
    await flushPromises()
    expect(wrapper.find('.modal-header [role="alert"]').text()).toMatch(/Changed elsewhere/)
    expect(api.save.mock.calls[0][1]).toHaveProperty('base_updated_at')

    await buttonByText(wrapper, 'Save').trigger('click')
    await flushPromises()
    expect(api.save.mock.calls[1][1]).not.toHaveProperty('base_updated_at')
    expect(wrapper.find('.modal-header [role="alert"]').exists()).toBe(false)
  })

  it('keeps the changes unsaved when saving fails, and says why', async () => {
    api.save.mockRejectedValueOnce({ message: 'x', response: { data: { detail: 'Storage is down' } } })
    const { wrapper, slotProps } = mountModal()
    await openOn(wrapper, 'regions/tavern')
    slotProps.markDirty()
    await nextTick()
    await buttonByText(wrapper, 'Save').trigger('click')
    await flushPromises()
    expect(buttonByText(wrapper, 'Save').attributes('disabled')).toBeUndefined()
    expect(wrapper.find('.modal-header [role="alert"]').text()).toBe('Not saved: Storage is down')

    await buttonByText(wrapper, 'Save').trigger('click')
    await flushPromises()
    expect(wrapper.find('.modal-header [role="alert"]').exists()).toBe(false)
  })

  it('keeps unsaved what changed while the save was on its way', async () => {
    let finish
    api.save.mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
    const { wrapper, slotProps } = mountModal()
    await openOn(wrapper, 'regions/tavern')
    slotProps.markDirty()
    await nextTick()
    await buttonByText(wrapper, 'Save').trigger('click')
    slotProps.doc.pins.push({ id: 'q', x: 3, y: 4, name: 'Door' }) // after the save was sent
    slotProps.markDirty()
    finish({})
    await flushPromises()
    expect(buttonByText(wrapper, 'Save').attributes('disabled')).toBeUndefined()
    expect(buttonByText(wrapper, 'Saved')).toBeUndefined()
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
    await wrapper.find('[aria-label="Back to Observatory"]').trigger('click')
    expect(wrapper.find('.editor-view').exists()).toBe(true)
    expect(observatory.isOpen.value).toBe(false)

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
    await slotProps.setAsset('image', '/api/observatory/images/1a2b3c4d-new.png')
    expect(api.setAsset).toHaveBeenCalledWith('regions/tavern', 'image', '/api/observatory/images/1a2b3c4d-new.png')
    expect(slotProps.doc.image_url).toBe('/api/observatory/images/1a2b3c4d-new.png')
    expect(buttonByText(wrapper, 'Saved')).toBeDefined() // not something left to Save
  })

  it('says so when its picture cannot be changed', async () => {
    api.setAsset.mockRejectedValueOnce({ response: { data: { detail: 'Not an Observatory image' } } })
    const { wrapper, slotProps } = mountModal()
    await openOn(wrapper, 'regions/tavern')
    await slotProps.setAsset('image', 'https://example.com/x.png')
    await nextTick()
    expect(wrapper.find('.modal-header [role="alert"]').text()).toBe('Picture not changed: Not an Observatory image')
    expect(slotProps.doc.image_url).toBe(MAP)
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

  it("shows the screen buttons its editor brings, the same as everyone's", async () => {
    const { useDocumentScreen } = await import('@/composables/useDocumentScreen')
    const { defineComponent, h, ref: r } = await import('vue')
    const own = { live: r(false), sending: r(false), canSend: r(true), send: vi.fn(), toggle: vi.fn(), liveHint: 'The screen follows your view' }
    const Editor = defineComponent({ setup() { useDocumentScreen(own); return () => h('div', 'map') } })
    const wrapper = mount(DocumentModal, {
      props: { kind: DOC_TYPES.battlemap, modal, api, canEdit: true },
      slots: { editor: () => h(Editor) }
    })
    await openOn(wrapper, 'cave')
    await buttonByText(wrapper, 'Send to screen').trigger('click')
    expect(own.send).toHaveBeenCalled()
    const live = buttonByText(wrapper, 'Go live')
    expect(live.attributes('title')).toBe('The screen follows your view')
    await live.trigger('click')
    expect(own.toggle).toHaveBeenCalled()
    own.live.value = true
    own.sending.value = true
    await nextTick()
    expect(buttonByText(wrapper, 'Live').attributes('aria-pressed')).toBe('true')
    expect(buttonByText(wrapper, 'Sent!')).toBeDefined()
    expect(post).not.toHaveBeenCalled() // the editor sends it, not the modal
  })

  it('takes its name from the live document, and follows a rename', async () => {
    liveDocs.fight = ref({ id: 'fight', rev: 1, name: 'The big fight' })
    const { wrapper } = mountModal(DOC_TYPES.encounter)
    await openOn(wrapper, 'fight')
    expect(followed).toEqual(['encounter:fight'])
    expect(api.fetchAll).not.toHaveBeenCalled()
    expect(wrapper.find('.modal-header').text()).toContain('The big fight')
    liveDocs.fight.value.name = 'The bigger fight'
    await nextTick()
    expect(wrapper.find('.modal-header').text()).toContain('The bigger fight')
  })

  it('goes back and closes without asking anything', async () => {
    const confirm = vi.spyOn(window, 'confirm')
    const { wrapper } = mountModal(DOC_TYPES.encounter)
    await openOn(wrapper, 'goblins/caves/fight')
    await wrapper.find('[aria-label="Back to Observatory"]').trigger('click')
    // Back is the Observatory, in the folder the document is in.
    expect(modal.isOpen.value).toBe(false)
    expect([observatory.isOpen.value, observatory.targetId.value]).toEqual([true, 'goblins/caves'])
    await openOn(wrapper, 'fight')
    await wrapper.find('[aria-label="Close"]').trigger('click')
    expect(modal.isOpen.value).toBe(false)
    expect(confirm).not.toHaveBeenCalled()
  })
})

describe('DocumentModal — where it is opened from', () => {
  it('switches to another document asked for while one is open', async () => {
    api.fetch.mockImplementation(async (id) => chart({ id, name: id === 'b' ? 'Bee' : 'Ay' }))
    const { wrapper } = mountModal()
    await openOn(wrapper, 'a')
    await openOn(wrapper, 'b') // picked in Ctrl+K, over the first
    expect(api.fetch).toHaveBeenLastCalledWith('b')
    expect(wrapper.find('.editor-view').text()).toBe('editing:b:Bee')
    expect(modal.targetId.value).toBeNull()
  })

  it('asks before leaving unsaved changes for another document, and stays if told no', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    api.fetch.mockImplementation(async (id) => chart({ id, name: id }))
    const { wrapper, slotProps } = mountModal()
    await openOn(wrapper, 'a')
    slotProps.markDirty()
    await openOn(wrapper, 'b')
    expect(confirm).toHaveBeenCalledOnce()
    expect(wrapper.find('.editor-view').text()).toBe('editing:a:a')

    confirm.mockReturnValue(true)
    await openOn(wrapper, 'b')
    expect(wrapper.find('.editor-view').text()).toBe('editing:b:b')
    expect(buttonByText(wrapper, 'Saved')).toBeDefined()
  })

  it('opens the Observatory instead when it is not opened on a document', async () => {
    const { wrapper } = mountModal()
    modal.open()
    await flushPromises()
    expect(modal.isOpen.value).toBe(false)
    expect([observatory.isOpen.value, observatory.targetId.value]).toEqual([true, null])
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
  })

  it("lets a live document's editor go back to the Observatory", async () => {
    api = fakeApi('characters')
    const { wrapper, slotProps } = mountModal(DOC_TYPES.character)
    await openOn(wrapper, 'party/aria')
    slotProps.back()
    await nextTick()
    expect([observatory.isOpen.value, observatory.targetId.value]).toEqual([true, 'party'])
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
  })
})
