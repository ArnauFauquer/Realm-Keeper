import { post } from '@/api/http'
import { apiUrl } from '@/config/env'

const SCREEN_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg><span>Screen</span>'
const SENT_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg><span>Sent!</span>'

/**
 * Gives every image of rendered markdown a "Screen" button (shown on hover)
 * that sends it to the table's screen. Chart/vista embeds are left alone:
 * they have their own screen button for the whole scene. The click itself
 * is handled by the markdown body's one listener (see sendImageToScreen).
 */
export function wrapImagesForScreen(root) {
  root.querySelectorAll('img').forEach((img) => {
    if (img.closest('.doc-embed') || img.closest('.img-screen-wrapper')) return

    const wrapper = document.createElement('span')
    wrapper.className = 'img-screen-wrapper'
    img.parentNode.insertBefore(wrapper, img)
    wrapper.appendChild(img)

    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'img-screen-btn'
    btn.title = 'Display on screen'
    btn.innerHTML = SCREEN_ICON
    wrapper.appendChild(btn)
  })
}

/** Sends the image next to a "Screen" button, and says so on the button for a moment. */
export async function sendImageToScreen(btn) {
  const img = btn.closest('.img-screen-wrapper')?.querySelector('img')
  if (!img) return
  try {
    await post(`${apiUrl}/api/screen/display`, { url: img.src, title: img.alt || '' })
    btn.innerHTML = SENT_ICON
    btn.classList.add('sent')
    setTimeout(() => {
      btn.classList.remove('sent')
      btn.innerHTML = SCREEN_ICON
    }, 2000)
  } catch (err) {
    console.error('Failed to send to screen:', err)
  }
}
