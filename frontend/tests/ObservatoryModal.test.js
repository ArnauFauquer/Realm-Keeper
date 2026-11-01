// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'

const { observatoryApi, docClients, openDoc, post } = vi.hoisted(() => ({
  observatoryApi: {
    list: vi.fn(), listKind: vi.fn(), createFolder: vi.fn(), renameFolder: vi.fn(), removeFolder: vi.fn(), moveFolder: vi.fn(),
    renameImage: vi.fn(), moveImage: vi.fn(), removeImage: vi.fn(),
    exportUrl: (path = '') => `/api/observatory/export${path ? `?path=${encodeURIComponent(path)}` : ''}`,
    importFiles: vi.fn()
  },
  docClients: {},
  openDoc: vi.fn(),
  post: vi.fn()
}))
vi.mock('@/api/observatory', () => ({ observatoryApi }))
vi.mock('@/api/docs', () => ({
  docApi: (type) => (docClients[type] ||= { create: vi.fn(), rename: vi.fn(), move: vi.fn(), remove: vi.fn() })
}))
vi.mock('@/api/http', async (importOriginal) => ({ ...(await importOriginal()), post }))
vi.mock('@/config/env', () => ({ apiUrl: '' }))
vi.mock('@/composables/useAuth', () => ({ useAuth: () => ({ user: ref({ email: 'gm@example.com' }) }) }))
vi.mock('@/composables/useDocModal', () => ({ useDocModal: (type) => ({ open: (id) => openDoc(type, id) }) }))

const ObservatoryModal = (await import('@/components/ObservatoryModal.vue')).default

const MAP = '/api/observatory/images/1a2b3c4d-map.png'
const LISTING = {
  folders: ['caves'],
  items: [
    { kind: 'chart', id: 'act 2/ambush', name: 'Ambush', image_url: MAP },
    { kind: 'encounter', id: 'act 2/ambush', name: 'Ambush' },
    { kind: 'image', id: '1a2b3c4d-map.png', name: 'map.png', url: MAP, folder: 'act 2' },
    { kind: 'vista', id: 'act 2/tavern', name: 'Tavern', background_url: null }
  ]
}

async function opened(props = {}) {
  const wrapper = mount(ObservatoryModal, { props: { isOpen: false, ...props } })
  await wrapper.setProps({ isOpen: true })
  await flushPromises()
  return wrapper
}

const cards = (wrapper) => wrapper.findAll('.gallery-card:not(.folder-card)')
const names = (wrapper) => cards(wrapper).map((card) => card.find('.gallery-card-name').text())
const buttonByText = (wrapper, text) => wrapper.findAll('button').find((b) => b.text().includes(text))

beforeEach(() => {
  vi.clearAllMocks()
  for (const key of Object.keys(docClients)) delete docClients[key]
  observatoryApi.list.mockResolvedValue(structuredClone(LISTING))
})

describe('ObservatoryModal — one tree for everything', () => {
  it('opens at the folder it is asked to, with documents of every kind and images side by side', async () => {
    const wrapper = await opened({ startPath: 'act 2' })
    expect(observatoryApi.list).toHaveBeenCalledWith('act 2')
    expect(names(wrapper)).toEqual(['Ambush', 'Ambush', 'map.png', 'Tavern'])
    expect(wrapper.find('.folder-card').text()).toContain('caves')
    // A document with a picture says in a corner what it is; one without shows its kind's icon.
    expect(cards(wrapper).map((card) => card.find('.kind-badge').exists())).toEqual([true, false, false, false])
    expect(cards(wrapper)[0].find('img').attributes('src')).toBe(MAP)
    expect(cards(wrapper)[1].find('.mdi-sword-cross').exists()).toBe(true)
    expect(cards(wrapper)[3].find('.mdi-image-frame').exists()).toBe(true) // a vista with no background yet
  })

  it('shows everything of one kind wherever it is, saying where, and goes back to the folders', async () => {
    observatoryApi.listKind.mockResolvedValue({ folders: [], items: [
      { kind: 'encounter', id: 'act 2/ambush', name: 'Ambush', folder: 'act 2' },
      { kind: 'encounter', id: 'fight', name: 'Fight', folder: '' }
    ] })
    const wrapper = await opened({ startPath: 'act 2' })
    await buttonByText(wrapper, 'Encounters').trigger('click')
    await flushPromises()
    expect(observatoryApi.listKind).toHaveBeenCalledWith('encounter')
    expect(names(wrapper)).toEqual(['Ambush', 'Fight'])
    expect(cards(wrapper).map((card) => card.find('.gallery-card-location').text())).toEqual(['act 2', 'Observatory'])
    expect(wrapper.find('.folder-card').exists()).toBe(false)
    expect(cards(wrapper)[0].attributes('draggable')).toBe('false') // nowhere to drag it from a flat list
    await buttonByText(wrapper, 'Folders').trigger('click')
    await flushPromises()
    expect(observatoryApi.list).toHaveBeenLastCalledWith('')
    expect(names(wrapper)).toHaveLength(4)
  })

  it('opens on everything of one kind when a shortcut asks', async () => {
    observatoryApi.listKind.mockResolvedValue({ folders: [], items: [{ kind: 'chart', id: 'wei', name: 'Wei', folder: '' }] })
    const wrapper = await opened({ startKind: 'chart' })
    expect(observatoryApi.listKind).toHaveBeenCalledWith('chart')
    expect(observatoryApi.list).not.toHaveBeenCalled()
    expect(names(wrapper)).toEqual(['Wei'])
    expect(wrapper.find('.kind-chip.active').text()).toBe('Charts')
  })

  it('goes where it is asked to while already open', async () => {
    const wrapper = await opened({ startPath: 'act 2' })
    await wrapper.setProps({ startPath: 'act 3' }) // useObservatoryModal().open('act 3') over it
    await flushPromises()
    expect(observatoryApi.list).toHaveBeenLastCalledWith('act 3')
    observatoryApi.listKind.mockResolvedValue({ folders: [], items: [] })
    await wrapper.setProps({ startPath: '', startKind: 'vista' })
    await flushPromises()
    expect(observatoryApi.listKind).toHaveBeenCalledWith('vista')
  })

  it('offers to copy what a note can show: a document it embeds, an image', async () => {
    const wrapper = await opened()
    expect(cards(wrapper).map((card) => card.find('[aria-label="Copy reference"]').exists())).toEqual([true, false, true, true])
  })

  it('hands a document to its editor, and closes', async () => {
    const wrapper = await opened()
    await cards(wrapper)[1].trigger('click')
    expect(openDoc).toHaveBeenCalledWith('encounter', 'act 2/ambush')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('opens an image to look at, and sends it to the screen', async () => {
    const wrapper = await opened()
    await cards(wrapper)[2].trigger('click')
    expect(wrapper.find('.viewer-view img').attributes('src')).toBe(MAP)
    await buttonByText(wrapper, 'Send to screen').trigger('click')
    expect(post).toHaveBeenCalledWith('/api/screen/display', { url: MAP, title: 'map.png' })
  })
})

describe('ObservatoryModal — making and changing things', () => {
  it('makes a document of any kind in the folder on screen, and opens it', async () => {
    const wrapper = await opened({ startPath: 'act 2' })
    await wrapper.find('[aria-haspopup="menu"]').trigger('click')
    await buttonByText(wrapper, 'Battlemap').trigger('click')
    const { create } = (await import('@/api/docs')).docApi('battlemap')
    create.mockResolvedValue({ id: 'act 2/cave', name: 'Cave' })
    await wrapper.find('input[aria-label="battlemap name"]').setValue(' Cave ')
    await wrapper.find('[aria-label="Create battlemap"]').trigger('click')
    await flushPromises()
    expect(create).toHaveBeenCalledWith('Cave', '', 'act 2')
    expect(openDoc).toHaveBeenCalledWith('battlemap', 'act 2/cave')
  })

  it("renames, moves and deletes each thing through what it is: a document's kind, or an image", async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const wrapper = await opened({ startPath: 'act 2' })
    const { docApi } = await import('@/api/docs')

    await cards(wrapper)[0].find('[aria-label="Delete"]').trigger('click')
    await flushPromises()
    expect(docApi('chart').remove).toHaveBeenCalledWith('act 2/ambush')

    await cards(wrapper)[2].find('[aria-label="Delete"]').trigger('click')
    await flushPromises()
    expect(observatoryApi.removeImage).toHaveBeenCalledWith('1a2b3c4d-map.png')

    await cards(wrapper)[2].find('[aria-label="Rename"]').trigger('click')
    await wrapper.find('.gallery-rename-input').setValue('cave.png')
    await wrapper.find('.gallery-rename-input').trigger('keyup.enter')
    await flushPromises()
    expect(observatoryApi.renameImage).toHaveBeenCalledWith('1a2b3c4d-map.png', 'cave.png')

    const gallery = wrapper.findComponent({ name: 'FolderGallery' })
    gallery.vm.$emit('move', { type: 'item', item: LISTING.items[1] }, 'act 2/caves')
    gallery.vm.$emit('move', { type: 'item', item: LISTING.items[2] }, '')
    gallery.vm.$emit('move', { type: 'folder', name: 'caves' }, '')
    await flushPromises()
    expect(docApi('encounter').move).toHaveBeenCalledWith('act 2/ambush', 'act 2/caves')
    expect(observatoryApi.moveImage).toHaveBeenCalledWith('1a2b3c4d-map.png', '')
    expect(observatoryApi.moveFolder).toHaveBeenCalledWith('act 2/caves', '')
  })

  it('says what went wrong and keeps the folder on screen', async () => {
    const wrapper = await opened()
    observatoryApi.createFolder.mockRejectedValue({ response: { data: { detail: "A folder already exists at 'caves'" } } })
    wrapper.findComponent({ name: 'FolderGallery' }).vm.$emit('create-folder', 'caves')
    await flushPromises()
    expect(wrapper.text()).toContain("A folder already exists at 'caves'")
  })

  it('imports images, documents and zips into the folder on screen, and says what it left out', async () => {
    observatoryApi.importFiles.mockResolvedValue({
      items: [{ kind: 'image', id: '9f9f9f9f-a.png', name: 'a.png', url: '/x' }],
      skipped: [{ path: 'notes.txt', reason: 'not an image or a document' }]
    })
    const wrapper = await opened({ startPath: 'act 2' })
    const input = wrapper.find('input[type="file"]')
    expect(input.attributes('accept')).toContain('.json')
    const files = [new File(['a'], 'a.png'), new File(['{}'], 'tavern.chart.json'), new File(['x'], 'notes.txt')]
    Object.defineProperty(input.element, 'files', { value: files, configurable: true })
    await input.trigger('change')
    await flushPromises()
    expect(observatoryApi.importFiles).toHaveBeenCalledWith('act 2', files)
    expect(observatoryApi.list).toHaveBeenCalledTimes(2) // and shows the folder again
    expect(wrapper.find('.import-report').text()).toContain('notes.txt: not an image or a document')
  })

  it('imports files dropped from the computer: on the gallery into the folder on screen, on a folder into it', async () => {
    observatoryApi.importFiles.mockResolvedValue({ items: [], skipped: [] })
    const wrapper = await opened({ startPath: 'act 2' })
    const file = new File(['a'], 'a.png', { type: 'image/png' })
    const dataTransfer = { types: ['Files'], files: [file] }
    await wrapper.find('.folder-gallery').trigger('dragover', { dataTransfer })
    expect(wrapper.find('.folder-gallery').classes()).toContain('files-over')
    await wrapper.find('.folder-gallery').trigger('drop', { dataTransfer })
    await flushPromises()
    const lastImport = () => observatoryApi.importFiles.mock.calls.at(-1)
    expect([lastImport()[0], lastImport()[1].map((f) => f.name)]).toEqual(['act 2', ['a.png']])
    expect(wrapper.find('.folder-gallery').classes()).not.toContain('files-over')
    await wrapper.find('.folder-card').trigger('drop', { dataTransfer })
    await flushPromises()
    expect([lastImport()[0], lastImport()[1].map((f) => f.name)]).toEqual(['act 2/caves', ['a.png']])
    expect(observatoryApi.importFiles).toHaveBeenCalledTimes(2)
    expect(observatoryApi.moveFolder).not.toHaveBeenCalled()
  })

  it('moves a card dragged onto a folder, without importing the thumbnail the browser drags along as a file', async () => {
    const { docApi } = await import('@/api/docs')
    const wrapper = await opened({ startPath: 'act 2' })
    const thumbnail = { types: ['text/uri-list', 'Files'], files: [new File(['a'], 'map.png', { type: 'image/png' })], setData: vi.fn() }
    const card = wrapper.findAll('.gallery-card:not(.folder-card)')[1]
    await card.trigger('dragstart', { dataTransfer: thumbnail })
    // Some data, or Firefox doesn't start the drag at all.
    expect(thumbnail.setData).toHaveBeenCalledWith('application/x-realm-keeper-move', 'encounter:act 2/ambush')
    await wrapper.find('.folder-gallery').trigger('dragover', { dataTransfer: thumbnail })
    expect(wrapper.find('.folder-gallery').classes()).not.toContain('files-over')
    await wrapper.find('.folder-card').trigger('drop', { dataTransfer: thumbnail })
    await flushPromises()
    expect(docApi('encounter').move).toHaveBeenCalledWith('act 2/ambush', 'act 2/caves')

    // Let go over the folder on screen: nothing happens, nothing is copied.
    await card.trigger('dragstart', { dataTransfer: thumbnail })
    await wrapper.find('.folder-gallery').trigger('drop', { dataTransfer: thumbnail })
    await card.trigger('dragend')
    await flushPromises()
    expect(observatoryApi.importFiles).not.toHaveBeenCalled()
  })
})

describe('ObservatoryModal — export', () => {
  it('downloads the folder on screen as a zip', async () => {
    const wrapper = await opened({ startPath: 'act 2' })
    const link = wrapper.findAll('a').find((a) => a.text().includes('Export'))
    expect(link.attributes('href')).toBe('/api/observatory/export?path=act%202')
    expect(link.attributes('download')).toBeDefined()
    expect(wrapper.text()).not.toContain('Restore')
  })
})

describe('ObservatoryModal — as a picker', () => {
  it('shows only folders and images, and picking one hands it back', async () => {
    const wrapper = await opened({ pickerMode: true, startPath: 'act 2' })
    expect(names(wrapper)).toEqual(['map.png'])
    expect(wrapper.find('[aria-haspopup="menu"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Export')
    await cards(wrapper)[0].trigger('click')
    expect(wrapper.emitted('select')).toEqual([[{ name: 'map', image_url: MAP }]])
  })

  it('picks an image as soon as it is uploaded', async () => {
    observatoryApi.importFiles.mockResolvedValue({
      items: [{ kind: 'image', id: '9f9f9f9f-new.png', name: 'new.png', url: '/api/observatory/images/9f9f9f9f-new.png' }], skipped: []
    })
    const wrapper = await opened({ pickerMode: true })
    const input = wrapper.find('input[type="file"]')
    expect(input.attributes('accept')).toBe('image/*')
    Object.defineProperty(input.element, 'files', { value: [new File(['a'], 'new.png', { type: 'image/png' })], configurable: true })
    await input.trigger('change')
    await flushPromises()
    await nextTick()
    expect(wrapper.emitted('select')).toEqual([[{ name: 'new', image_url: '/api/observatory/images/9f9f9f9f-new.png' }]])
  })
})
