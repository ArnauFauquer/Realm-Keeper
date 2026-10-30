// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { display } = vi.hoisted(() => ({ display: vi.fn() }))
vi.mock('@/api/screen', () => ({ screenApi: { display } }))

const { wrapImagesForScreen, sendImageToScreen, showSent } = await import('@/composables/useImageScreenButtons')

let root
beforeEach(() => {
  display.mockReset().mockResolvedValue()
  root = document.createElement('div')
  root.innerHTML = '<p><img src="http://x.test/a.png" alt="Cave"></p><div class="doc-embed"><img src="http://x.test/e.png"></div>'
})

describe('wrapImagesForScreen', () => {
  it('gives each image a Screen button, but leaves document embeds alone', () => {
    wrapImagesForScreen(root)
    expect(root.querySelectorAll('.img-screen-wrapper')).toHaveLength(1)
    const btn = root.querySelector('.img-screen-wrapper .img-screen-btn')
    expect(btn.type).toBe('button')
    expect(btn.title).toBe('Display on screen')
    expect(root.querySelector('.doc-embed .img-screen-btn')).toBeNull()
  })

  it('does not wrap an image twice', () => {
    wrapImagesForScreen(root)
    wrapImagesForScreen(root)
    expect(root.querySelectorAll('.img-screen-btn')).toHaveLength(1)
  })
})

describe('sendImageToScreen', () => {
  it('sends the image with its alt text as caption', async () => {
    wrapImagesForScreen(root)
    const btn = root.querySelector('.img-screen-btn')
    expect(await sendImageToScreen(btn)).toBe(true)
    expect(display).toHaveBeenCalledWith('http://x.test/a.png', 'Cave')
  })

  it('sends an empty caption for an image without alt', async () => {
    root.innerHTML = '<img src="http://x.test/b.png">'
    wrapImagesForScreen(root)
    await sendImageToScreen(root.querySelector('.img-screen-btn'))
    expect(display).toHaveBeenCalledWith('http://x.test/b.png', '')
  })

  it('is false for a button that is not next to an image', async () => {
    expect(await sendImageToScreen(document.createElement('button'))).toBe(false)
    expect(display).not.toHaveBeenCalled()
  })

  it('is false, and logs, when the screen refuses', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    display.mockRejectedValue(new Error('no'))
    wrapImagesForScreen(root)
    expect(await sendImageToScreen(root.querySelector('.img-screen-btn'))).toBe(false)
    expect(log).toHaveBeenCalled()
    log.mockRestore()
  })
})

describe('showSent', () => {
  it('toggles between Screen and Sent!', () => {
    const btn = document.createElement('button')
    showSent(btn, true)
    expect(btn.textContent).toBe('Sent!')
    expect(btn.classList.contains('sent')).toBe(true)
    showSent(btn, false)
    expect(btn.textContent).toBe('Screen')
    expect(btn.classList.contains('sent')).toBe(false)
  })
})
