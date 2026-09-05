// Obsidian-style callouts: `> [!type] Optional title` followed by `>`-prefixed
// body lines. Types map to Obsidian's own canonical aliases so vaults written
// in Obsidian render the same way here.
const CALLOUT_META = {
  note: { icon: 'mdi-pencil-outline', color: 'blue' },
  abstract: { icon: 'mdi-clipboard-text-outline', color: 'cyan' },
  summary: { icon: 'mdi-clipboard-text-outline', color: 'cyan' },
  tldr: { icon: 'mdi-clipboard-text-outline', color: 'cyan' },
  info: { icon: 'mdi-information-outline', color: 'blue' },
  todo: { icon: 'mdi-checkbox-marked-circle-outline', color: 'blue' },
  tip: { icon: 'mdi-fire', color: 'teal' },
  hint: { icon: 'mdi-fire', color: 'teal' },
  important: { icon: 'mdi-fire', color: 'teal' },
  success: { icon: 'mdi-check-bold', color: 'green' },
  check: { icon: 'mdi-check-bold', color: 'green' },
  done: { icon: 'mdi-check-bold', color: 'green' },
  question: { icon: 'mdi-help-circle-outline', color: 'amber' },
  help: { icon: 'mdi-help-circle-outline', color: 'amber' },
  faq: { icon: 'mdi-help-circle-outline', color: 'amber' },
  warning: { icon: 'mdi-alert-outline', color: 'orange' },
  caution: { icon: 'mdi-alert-outline', color: 'orange' },
  attention: { icon: 'mdi-alert-outline', color: 'orange' },
  failure: { icon: 'mdi-close-circle-outline', color: 'red' },
  fail: { icon: 'mdi-close-circle-outline', color: 'red' },
  missing: { icon: 'mdi-close-circle-outline', color: 'red' },
  danger: { icon: 'mdi-lightning-bolt-outline', color: 'red' },
  error: { icon: 'mdi-lightning-bolt-outline', color: 'red' },
  bug: { icon: 'mdi-bug-outline', color: 'red' },
  example: { icon: 'mdi-format-list-bulleted', color: 'purple' },
  quote: { icon: 'mdi-format-quote-close', color: 'grey' },
  cite: { icon: 'mdi-format-quote-close', color: 'grey' }
}
const DEFAULT_META = { icon: 'mdi-message-outline', color: 'grey' }

const CALLOUT_HEADER_RE = /^>\s?\[!([A-Za-z]+)\][-+]?\s*(.*)$/

/**
 * Rewrites `> [!type] Title` blockquote blocks into raw HTML callout divs
 * inside the given markdown text, recursively rendering their body through
 * mdRenderFn so the rest of the pipeline (wikilinks already resolved,
 * formatting, nested callouts) still applies. Plain blockquotes are left
 * untouched. mdRenderFn is only invoked for callout bodies that have one.
 */
export function renderCallouts(markdownText, mdRenderFn) {
  const lines = markdownText.split('\n')
  const output = []
  let i = 0

  while (i < lines.length) {
    const header = lines[i].match(CALLOUT_HEADER_RE)
    if (!header) {
      output.push(lines[i])
      i++
      continue
    }

    const [, type, title] = header
    const bodyLines = []
    i++
    while (i < lines.length && lines[i].startsWith('>')) {
      bodyLines.push(lines[i].replace(/^>\s?/, ''))
      i++
    }

    output.push(renderCalloutHtml(type, title.trim(), bodyLines.join('\n'), mdRenderFn))
  }

  return output.join('\n')
}

function renderCalloutHtml(type, title, bodyMarkdown, mdRenderFn) {
  const key = type.toLowerCase()
  const meta = CALLOUT_META[key] || DEFAULT_META
  const label = escapeHtml(title || key.charAt(0).toUpperCase() + key.slice(1))
  const bodyMd = bodyMarkdown.trim()
  const bodyHtml = bodyMd ? mdRenderFn(renderCallouts(bodyMd, mdRenderFn)) : ''

  return `\n<div class="callout callout-${meta.color}">\n` +
    `<p class="callout-title"><span class="mdi ${meta.icon}"></span><span>${label}</span></p>\n` +
    (bodyHtml ? `<div class="callout-content">\n\n${bodyHtml}\n\n</div>\n` : '') +
    `</div>\n`
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
