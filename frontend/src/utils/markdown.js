import MarkdownIt from 'markdown-it'
import { parseInlineRef, renderInlineRef } from './inlineRefs'
import { rollTablesPlugin } from './rollTables'

/**
 * The markdown renderer notes and sheets share: inline code that is a dice
 * formula, a song or a chart/vista reference becomes an actionable
 * placeholder (see inlineRefs.js). `refKinds` limits which kinds do — a
 * sheet has no use for an embedded chart, so it asks for ['dice'] only.
 * A table headed by a die becomes a roll table (see rollTables.js) unless
 * `rollTables` is false.
 */
export function createMarkdown({ refKinds = null, rollTables = !refKinds } = {}) {
  const md = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: true,
    breaks: true
  })

  const defaultCodeInline = md.renderer.rules.code_inline || function (tokens, idx, options, env, self) {
    return self.renderToken(tokens, idx, options)
  }
  md.renderer.rules.code_inline = (tokens, idx, options, env, self) => {
    const ref = parseInlineRef(tokens[idx].content)
    if (ref && (!refKinds || refKinds.includes(ref.kind))) return renderInlineRef(ref, md.utils.escapeHtml)
    return defaultCodeInline(tokens, idx, options, env, self)
  }

  if (rollTables) md.use(rollTablesPlugin)

  return md
}
