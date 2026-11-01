// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { useCopyToClipboard } from '@/composables/useCopyToClipboard'

function use() {
  let result
  mount(defineComponent({ setup() { result = useCopyToClipboard(); return () => h('div') } }))
  return result
}

const setClipboard = (clipboard) => Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true })

afterEach(() => vi.restoreAllMocks())

describe('useCopyToClipboard', () => {
  it('copies, and says which one was copied', async () => {
    const writeText = vi.fn().mockResolvedValue()
    setClipboard({ writeText })
    const { copy, copiedKey } = use()
    expect(await copy('`chart:tavern`', 'chart:tavern')).toBe(true)
    expect(writeText).toHaveBeenCalledWith('`chart:tavern`')
    expect(copiedKey.value).toBe('chart:tavern')
  })

  it('hands the text over in a prompt when there is no clipboard (plain HTTP)', async () => {
    setClipboard(undefined)
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue(null)
    const { copy, copiedKey } = use()
    expect(await copy('`chart:tavern`')).toBe(false)
    expect(prompt).toHaveBeenCalledWith('Copy it from here:', '`chart:tavern`')
    expect(copiedKey.value).toBeNull()

    await copy('https://rk.lan/screen#key=abc', 'screen-link', 'Screen link:')
    expect(prompt).toHaveBeenLastCalledWith('Screen link:', 'https://rk.lan/screen#key=abc')
  })

  it('also when the browser refuses', async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error('NotAllowedError')) })
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue(null)
    const { copy } = use()
    expect(await copy('text')).toBe(false)
    expect(prompt).toHaveBeenCalledOnce()
  })
})
