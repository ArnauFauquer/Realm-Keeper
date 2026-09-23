import DOMPurify from 'dompurify'

// Note markdown is rendered with raw HTML enabled (Obsidian vaults lean on
// it) and injected via v-html, on a page anyone can open — so anything that
// lands in the vault (a note edited in the UI, or pushed straight to the git
// repo) would otherwise run as script in every viewer's session. This keeps
// the markup (classes, ids, data-* hooks NoteView wires up afterwards,
// embedded iframes) and drops scripts, event handlers and javascript: URLs.
//
// A private instance, not the shared default: mermaid uses that same
// (deduped) DOMPurify and adds/removes its own global hooks around its
// diagrams, which would otherwise override or drop the hook below.
const purify = DOMPurify(window)

purify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && node.getAttribute('target')) {
    node.setAttribute('rel', 'noopener noreferrer')
  }
  // Embeds (YouTube, maps...) still play, but can't navigate the app,
  // open dialogs or be handed permissions (camera, clipboard...) by the note.
  if (node.tagName === 'IFRAME') {
    node.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-presentation')
  }
})

const CONFIG = {
  ADD_TAGS: ['iframe'],
  ADD_ATTR: ['target', 'allowfullscreen', 'frameborder'],
  // <style> restyles the whole app, not just the note; forms and their
  // controls could fake a sign-in prompt that posts elsewhere. Inline
  // style="" attributes stay: Obsidian vaults use them for coloured text.
  FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select'],
  FORBID_ATTR: ['allow']
}

export function sanitizeHtml(html) {
  return purify.sanitize(html, CONFIG)
}

const ASSET_LIBRARY_PATH = '/api/asset-library/assets/'

// Asset library images are behind login, but notes aren't: for a signed-out
// reader, swap each such <img> for a placeholder instead of a broken image.
export function lockAssetImages(html) {
  if (!html.includes(ASSET_LIBRARY_PATH)) return html
  const template = document.createElement('template')
  template.innerHTML = html
  for (const img of template.content.querySelectorAll('img')) {
    let path
    try {
      path = new URL(img.getAttribute('src') || '', window.location.origin).pathname
    } catch {
      continue
    }
    if (!path.startsWith(ASSET_LIBRARY_PATH)) continue
    const placeholder = document.createElement('span')
    placeholder.className = 'locked-asset'
    placeholder.innerHTML = '<span class="mdi mdi-lock-outline"></span>Sign in to view this image'
    img.replaceWith(placeholder)
  }
  return template.innerHTML
}
