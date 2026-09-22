// Inline-code spans in a note that turn into something actionable instead of
// plain code: a dice formula (`4d8+2d2`), a music track
// (`Action/01 Beyond Distant Lands.mp3`), or an embedded chart / vista
// (`chart:regions/tavern-map`, `vista:tavern/night`). The note renderer only
// emits placeholder markup here; NoteView wires the behavior afterwards.
import { parseDiceFormula } from './diceNotation'
import { parseSongKey } from './audioLink'

// Chart/vista ids are "<folder path>/<slug>" ("La Biblioteca Olvidada/la-entrada"),
// see chart_service/vista_service create_* — folder names may contain spaces.
const DOC_REF_RE = /^(chart|vista):(\S.*)$/i

export const DOC_EMBED_ICONS = {
  chart: 'mdi-map-marker-radius',
  vista: 'mdi-image-filter-hdr'
}

/** Parses "chart:<id>" / "vista:<id>" into { type, id }, or null. */
export function parseDocRef(text) {
  const match = DOC_REF_RE.exec(text.trim())
  if (!match) return null
  return { type: match[1].toLowerCase(), id: match[2].replace(/^\/+|\/+$/g, '') }
}

/** The markdown to paste into a note to embed a chart/vista. */
export function docRefMarkdown(type, id) {
  return '`' + `${type}:${id}` + '`'
}

/** Classifies an inline-code span, or returns null for ordinary code. */
export function parseInlineRef(text) {
  const formula = text.trim()
  if (parseDiceFormula(formula)) return { kind: 'dice', formula }
  const song = parseSongKey(formula)
  if (song) return { kind: 'song', ...song }
  const doc = parseDocRef(formula)
  if (doc) return { kind: 'doc', ...doc }
  return null
}

/** Placeholder HTML for a parsed inline ref (escape = markdown-it's escapeHtml). */
export function renderInlineRef(ref, escape) {
  if (ref.kind === 'dice') {
    const f = escape(ref.formula)
    return `<code class="dice-roll" data-dice-formula="${f}" role="button" tabindex="0" title="Roll ${f}">` +
      `<span class="mdi mdi-dice-multiple"></span>${f}</code>`
  }
  if (ref.kind === 'song') {
    const key = escape(ref.key)
    return `<code class="song-link" data-song-key="${key}" role="button" tabindex="0" title="Play ${key}">` +
      `<span class="mdi mdi-play-circle-outline"></span>${escape(ref.filename)}</code>`
  }
  const id = escape(ref.id)
  return `<span class="doc-embed" data-doc-embed="${ref.type}" data-doc-id="${id}">` +
    `<span class="doc-embed-placeholder"><span class="mdi ${DOC_EMBED_ICONS[ref.type]}"></span>${ref.type}:${id}</span></span>`
}
