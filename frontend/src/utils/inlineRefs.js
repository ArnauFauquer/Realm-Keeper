// Inline-code spans in a note that turn into something actionable instead of
// plain code: a dice formula (`4d8+2d2`, `adv+5`, `roll:hf`), a music track
// (`Action/01 Beyond Distant Lands.mp3`), a sound effect played over the
// music (`sfx:Efectos/door.mp3`), or an embedded chart / vista
// (`chart:regions/tavern-map`, `vista:tavern/night`). The note renderer only
// emits placeholder markup here; NoteView wires the behavior afterwards.
import { parseDiceFormula } from './diceNotation'
import { parseSfxRef, parseSongKey } from './audioLink'
import { EMBEDDABLE_TYPES, embedIcon } from './docTypes'

// A document's id is "<folder path>/<slug>" ("La Biblioteca Olvidada/la-entrada")
// and folder names may contain spaces. Which kinds a note can embed is up to
// utils/docTypes.js.
const DOC_REF_RE = new RegExp(String.raw`^(${EMBEDDABLE_TYPES.join('|')}):(\S.*)$`, 'i')

/** Parses "chart:<id>" / "vista:<id>" into { type, id }, or null. */
export function parseDocRef(text) {
  const match = DOC_REF_RE.exec(text.trim())
  if (!match) return null
  return { type: match[1].toLowerCase(), id: match[2].replace(/^\/+|\/+$/g, '') }
}

/** The markdown to paste into a note to embed a document. */
export function docRefMarkdown(type, id) {
  return '`' + `${type}:${id}` + '`'
}

const ROLL_PREFIX_RE = /^roll:\s*/i
const DICE_KEYWORD_RE = /hf|adv|dis/gi

/**
 * The dice formula an inline-code span stands for, or null. `roll:` makes
 * any formula explicit. Without it, a formula made only of keywords (`hf`,
 * `adv`, `dis`) is left as ordinary code - those are plain words someone
 * may well write as code meaning something else - while one that also has
 * a number or dice (`adv+5`, `hf+1d6`, `2d6`) is clearly a roll.
 */
export function parseDiceRef(text) {
  const trimmed = text.trim()
  const explicit = ROLL_PREFIX_RE.test(trimmed)
  const formula = trimmed.replace(ROLL_PREFIX_RE, '')
  if (!parseDiceFormula(formula)) return null
  if (!explicit && !/\d|d%/i.test(formula.replace(DICE_KEYWORD_RE, ''))) return null
  return formula
}

/** Classifies an inline-code span, or returns null for ordinary code. */
export function parseInlineRef(text) {
  const formula = parseDiceRef(text)
  if (formula) return { kind: 'dice', formula }
  const trimmed = text.trim()
  const sfx = parseSfxRef(trimmed)
  if (sfx) return { kind: 'sfx', ...sfx }
  const song = parseSongKey(trimmed)
  if (song) return { kind: 'song', ...song }
  const doc = parseDocRef(trimmed)
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
  if (ref.kind === 'sfx') {
    const key = escape(ref.key)
    const name = escape(ref.filename.replace(/\.[^.]+$/, ''))
    return `<code class="sfx-button" data-sfx-key="${key}" role="button" tabindex="0" aria-pressed="false" title="Sound effect: ${key}">` +
      `<span class="mdi mdi-waveform"></span>${name}</code>`
  }
  const id = escape(ref.id)
  return `<span class="doc-embed" data-doc-embed="${ref.type}" data-doc-id="${id}">` +
    `<span class="doc-embed-placeholder"><span class="mdi ${embedIcon(ref.type)}"></span>${ref.type}:${id}</span></span>`
}
