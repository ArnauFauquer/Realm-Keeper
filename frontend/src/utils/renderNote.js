import { createMarkdown } from './markdown'
import { renderCallouts } from './callouts'
import { sanitizeHtml } from './sanitizeHtml'
import { slugifyHeading } from './slugify'

// One renderer for a note, wherever it is shown: the note itself and the
// editor's preview. Both get the same callouts, heading ids, mermaid blocks
// and scrollable tables, and the table of contents reads its headings from
// here rather than parsing the markdown a second time (and slugging it a
// little differently).

const md = createMarkdown()

const defaultFence = md.renderer.rules.fence || function (tokens, idx, options, env, self) {
  return self.renderToken(tokens, idx, options)
}
// A ```mermaid block is drawn by mermaid once the HTML is in the page.
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx]
  if (token.info.trim().toLowerCase() === 'mermaid') {
    return `<pre class="mermaid">${md.utils.escapeHtml(token.content)}</pre>`
  }
  return defaultFence(tokens, idx, options, env, self)
}

const HEADING_RE = /<h([1-6])>([\s\S]*?)<\/h\1>/g
const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

/** The visible text of a bit of rendered HTML: no tags, entities decoded. */
export function htmlToText(html) {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code) => {
      if (code[0] === '#') {
        const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
        try {
          return String.fromCodePoint(point)
        } catch {
          return entity
        }
      }
      return NAMED_ENTITIES[code.toLowerCase()] ?? entity
    })
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Renders a note's markdown to safe HTML, and lists its headings
 * ({ level, text, id }, in page order) for the table of contents.
 *
 * Heading ids are slugs of what the heading shows (so `## Fight & Loot` is
 * `fight-loot`), numbered -1, -2... on repeats, and cover every heading the
 * HTML ends up with: setext ones, ones inside callouts, raw `<h2>`s.
 */
export function renderNote(markdown) {
  const withCallouts = renderCallouts(markdown || '', (text) => md.render(text))
  let html = sanitizeHtml(md.render(withCallouts))

  // Internal links are routed in the app instead of reloading it (see
  // MarkdownBody); the marker is also what prefetching on hover looks for.
  html = html.replace(/<a href="\/note\/([^"]+)"/g, '<a href="/note/$1" data-note-link="$1"')

  // A wide table scrolls on its own instead of widening the page.
  html = html
    .replace(/<table\b/g, '<div class="table-scroll"><table')
    .replace(/<\/table>/g, '</table></div>')

  // Added after sanitizing: DOMPurify drops ids that match a property of
  // `document` (a heading called "Title" or "Images"), and a slug is only
  // letters, digits and hyphens anyway.
  const headings = []
  const counts = {}
  html = html.replace(HEADING_RE, (match, level, inner) => {
    const text = htmlToText(inner)
    const id = slugifyHeading(text, counts)
    headings.push({ level: Number(level), text, id })
    return `<h${level} id="${id}">${inner}</h${level}>`
  })

  return { html, headings }
}

/** Whether rendered HTML has a mermaid diagram to draw. */
export function hasMermaid(html) {
  return html.includes('<pre class="mermaid">')
}
