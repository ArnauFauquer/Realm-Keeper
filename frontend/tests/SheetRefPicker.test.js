// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

const { fetchSheets } = vi.hoisted(() => ({ fetchSheets: vi.fn() }))
vi.mock('@/api/sheets', () => ({ fetchSheets }))

const SheetRefPicker = (await import('@/components/SheetRefPicker.vue')).default

const SHEETS = [
  { type: 'character', ref: 'party/aria', name: 'Aria', folder: 'party', subtitle: 'Ranger', tags: ['elf'] },
  { type: 'adversary', ref: 'bestiary/bugboar', name: 'Bugboar', folder: 'bestiary', tags: [] }
]
const opened = async () => {
  const w = mount(SheetRefPicker)
  await w.find('button').trigger('click')
  await flushPromises()
  return w
}

beforeEach(() => { fetchSheets.mockReset().mockResolvedValue(SHEETS) })

describe('SheetRefPicker', () => {
  it('is closed until asked, then lists the sheets', async () => {
    let arrive
    fetchSheets.mockReturnValue(new Promise((resolve) => { arrive = resolve }))
    const w = mount(SheetRefPicker)
    expect(w.find('.picker-panel').exists()).toBe(false)
    await w.find('button').trigger('click')
    expect(w.text()).toContain('Loading')
    arrive(SHEETS)
    await flushPromises()
    expect(w.findAll('.picker-item').map((i) => i.find('.picker-name').text())).toEqual(['Aria', 'Bugboar'])
  })

  it('filters by name, folder, subtitle and tag', async () => {
    const w = await opened()
    const search = w.find('input')
    for (const [q, names] of [['bug', ['Bugboar']], ['PARTY', ['Aria']], ['ranger', ['Aria']], ['elf', ['Aria']]]) {
      await search.setValue(q)
      expect(w.findAll('.picker-name').map((n) => n.text())).toEqual(names)
    }
    await search.setValue('zzz')
    expect(w.text()).toContain('Nothing matches')
  })

  it('inserts the link of the picked sheet and closes', async () => {
    const w = await opened()
    await w.findAll('.picker-item')[1].trigger('click')
    expect(w.emitted('pick')[0]).toEqual(['`adversary:bestiary/bugboar`'])
    expect(w.find('.picker-panel').exists()).toBe(false)
  })

  it('picks the first match on Enter, and closes on Escape', async () => {
    const w = await opened()
    await w.find('input').setValue('aria')
    await w.find('input').trigger('keydown', { key: 'Enter' })
    expect(w.emitted('pick')[0]).toEqual(['`character:party/aria`'])
    await w.find('button').trigger('click')
    await flushPromises()
    await w.find('input').trigger('keydown', { key: 'Escape' })
    expect(w.find('.picker-panel').exists()).toBe(false)
  })

  it('does nothing on Enter when nothing matches', async () => {
    const w = await opened()
    await w.find('input').setValue('zzz')
    await w.find('input').trigger('keydown', { key: 'Enter' })
    expect(w.emitted('pick')).toBeUndefined()
  })

  it('says so when there are no sheets', async () => {
    fetchSheets.mockResolvedValue([])
    expect((await opened()).text()).toContain('No characters or adversaries yet')
  })

  it("shows the server's reason when loading fails", async () => {
    fetchSheets.mockImplementation(() => Promise.reject({ response: { data: { detail: 'Vault offline' } } }))
    expect((await opened()).find('.picker-error').text()).toBe('Vault offline')
  })

  it('reloads each time it opens and clears the search', async () => {
    const w = await opened()
    await w.find('input').setValue('aria')
    await w.find('button').trigger('click')
    await w.find('button').trigger('click')
    await flushPromises()
    expect(fetchSheets).toHaveBeenCalledTimes(2)
    expect(w.find('input').element.value).toBe('')
  })
})
