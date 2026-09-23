import DOMPurify from 'dompurify'

// Note markdown is rendered with raw HTML enabled (Obsidian vaults lean on
// it) and injected via v-html, on a page anyone can open — so anything that
// lands in the vault (a note edited in the UI, or pushed straight to the git
// repo) would otherwise run as script in every viewer's session. This keeps
// the markup (classes, ids, data-* hooks NoteView wires up afterwards,
// embedded iframes) and drops scripts, event handlers and javascript: URLs.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && node.getAttribute('target')) {
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

const CONFIG = {
  ADD_TAGS: ['iframe'],
  ADD_ATTR: ['target', 'allow', 'allowfullscreen', 'frameborder']
}

export function sanitizeHtml(html) {
  return DOMPurify.sanitize(html, CONFIG)
}
