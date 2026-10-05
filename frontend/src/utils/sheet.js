// A sheet's YAML (a character's or an adversary's `source`) turned into the
// normalized shape the sheet component renders. backend/services/sheet_parser.py
// does the same normalization; both are checked against the shared cases in
// backend/tests/fixtures/sheets/, so a change here needs the same change there.
import { parse } from 'yaml'

export const SHEET_TYPES = ['character', 'adversary']

// Same limit as the backend (services/sheet_parser.py), and no aliases for the
// same reason: a few nested ones expand to gigabytes.
const MAX_SOURCE_LENGTH = 100_000

const KNOWN_FIELDS = new Set(['id', 'name', 'type', 'subtitle', 'image', 'tags', 'stats', 'sections', 'columns', 'text'])
// How many columns a layout may ask for (the sheet's sections, a section's
// items, a group of stats). Narrow screens fall back to fewer on their own.
const MAX_COLUMNS = 12
const IMAGE_URL_PREFIX = '/api/observatory/images/'
// An Observatory image's file name: its uid, then its name ("1a2b3c4d-boar.png").
const IMAGE_FILE_NAME = /^[0-9a-f]{8}-[^/]+\.(png|jpe?g|webp|gif|svg)$/i

export class SheetParseError extends Error {}

const isMapping = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

/** Lowercase ASCII with hyphens: "Jabalí Gigante" -> "jabali-gigante". */
export function slugify(text) {
  return String(text)
    .normalize('NFKD')
    .replace(/[^\x00-\x7f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function text(value) {
  if (value === null || value === undefined) return null
  const trimmed = String(value).trim()
  return trimmed || null
}

function tags(value) {
  if (value === null || value === undefined) return []
  const items = typeof value === 'string' ? value.split(',') : Array.isArray(value) ? value : [value]
  return items.map(text).filter(Boolean)
}

// Quoted as the backend quotes it (Python's quote(name, safe="")), so both
// sides make the same URL of a file name.
const quoteName = (name) =>
  encodeURIComponent(name).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)

/** [url, warning]: an Observatory image is kept as the app's relative URL, so
 * one pasted with the site's address in front (or as its bare file name) still matches. */
export function normalizeImage(value) {
  const image = text(value)
  if (!image) return [null, null]
  const marker = image.indexOf(IMAGE_URL_PREFIX)
  if (marker !== -1) return [image.slice(marker), null]
  if (IMAGE_FILE_NAME.test(image)) return [IMAGE_URL_PREFIX + quoteName(image), null]
  if (/^https?:\/\//i.test(image)) return [image, null]
  return [null, 'image must be the URL of an Observatory image, as copied from the Observatory']
}

function integer(value, what) {
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new SheetParseError(`${what} must be a whole number`)
  return value
}

function counter(name, raw) {
  let spec
  if (isMapping(raw)) {
    if (!('max' in raw)) throw new SheetParseError(`counter '${name}' needs a max`)
    spec = {
      max: integer(raw.max, `counter '${name}' max`),
      min: integer(raw.min ?? 0, `counter '${name}' min`),
      start: raw.start === null || raw.start === undefined ? null : integer(raw.start, `counter '${name}' start`),
      color: text(raw.color),
      style: text(raw.style)
    }
  } else {
    spec = { max: integer(raw, `counter '${name}'`), min: 0, start: null, color: null, style: null }
  }
  if (spec.min > spec.max) throw new SheetParseError(`counter '${name}' has a min above its max`)
  return spec
}

function counters(raw) {
  if (raw === null || raw === undefined) return {}
  if (!isMapping(raw)) throw new SheetParseError("a section's counters must be a mapping of name to maximum, e.g. HP: 6")
  return Object.fromEntries(Object.entries(raw).map(([name, value]) => [name, counter(name, value)]))
}

function columns(value, what) {
  if (value === null || value === undefined) return null
  const n = integer(value, what)
  if (n < 1 || n > MAX_COLUMNS) throw new SheetParseError(`${what} must be between 1 and ${MAX_COLUMNS}`)
  return n
}

function statList(raw) {
  return Object.entries(raw).map(([label, value]) =>
    isMapping(value)
      ? { label, value: value.value ?? null, roll: text(value.roll) }
      : { label, value: value ?? null, roll: null }
  )
}

// A group is either a plain mapping of stats, or { title, columns, stats }
// (told apart by having a `stats` key).
function statGroup(raw) {
  if (!isMapping(raw)) throw new SheetParseError('each group of stats must be a mapping of label to value')
  if ('stats' in raw) {
    if (!isMapping(raw.stats)) throw new SheetParseError("a stat group's stats must be a mapping of label to value")
    return { title: text(raw.title), columns: columns(raw.columns, "a stat group's columns"), stats: statList(raw.stats) }
  }
  return { title: null, columns: null, stats: statList(raw) }
}

/** Always a list of groups: a single mapping is one untitled group. */
function stats(raw) {
  if (raw === null || raw === undefined) return []
  if (Array.isArray(raw)) return raw.map(statGroup)
  if (!isMapping(raw)) throw new SheetParseError('stats must be a mapping of label to value, or a list of groups of them')
  return Object.keys(raw).length ? [statGroup(raw)] : []
}

function item(raw) {
  if (isMapping(raw)) {
    return { name: text(raw.name), text: text(raw.text), roll: text(raw.roll), tags: tags(raw.tags), cost: text(raw.cost) }
  }
  return { name: null, text: text(raw), roll: null, tags: [], cost: null }
}

/** { sections, resources }: each section names its counters, and every
 * counter of the sheet is also in `resources` (by name, in order), which is
 * what encounters and saved characters go by. */
function sections(raw) {
  if (raw === null || raw === undefined) return { sections: [], resources: {} }
  if (!Array.isArray(raw) || !raw.every(isMapping)) {
    throw new SheetParseError('sections must be a list, each with a title and its items')
  }
  const resources = {}
  const list = raw.map((section) => {
    if (section.items !== null && section.items !== undefined && !Array.isArray(section.items)) {
      throw new SheetParseError("a section's items must be a list")
    }
    const own = counters(section.counters)
    for (const [name, spec] of Object.entries(own)) {
      if (name in resources) throw new SheetParseError(`counter '${name}' is defined twice: counter names must be unique in a sheet`)
      resources[name] = spec
    }
    return {
      title: text(section.title),
      columns: columns(section.columns, "a section's columns"),
      wide: section.wide === true,
      collapsed: section.collapsed === true,
      tab: text(section.tab),
      counters: Object.keys(own),
      stats: stats(section.stats),
      items: (section.items || []).map(item)
    }
  })
  return { sections: list, resources }
}

// What a sheet document holds outside its YAML: its name is the document's
// (renamed from the gallery), its id is where it is stored, and its type is its
// kind. The YAML may still carry them; they are ignored, and the author told so.
const DOCUMENT_FIELDS = ['id', 'name', 'type']

/**
 * { sheet, warnings } for a sheet's YAML. Throws SheetParseError, whose
 * message is meant for the sheet's author. `document` ({ name, id, type }) is
 * a sheet document's own: given, it is what the sheet is called, and an empty
 * source is an empty sheet (see parseSheetDoc).
 */
export function parseSheetSource(source, document = null) {
  if (source.length > MAX_SOURCE_LENGTH) throw new SheetParseError(`A sheet can't be longer than ${MAX_SOURCE_LENGTH / 1000} KB`)
  let data
  try {
    data = parse(source, { maxAliasCount: 0 })
  } catch (e) {
    throw new SheetParseError(`Invalid YAML: ${e.message.split('\n')[0]}`)
  }
  if ((data === null || data === undefined) && document) data = {}
  if (!isMapping(data)) throw new SheetParseError('A sheet must be a YAML mapping (subtitle: ..., sections: ...)')
  if ('resources' in data) {
    throw new SheetParseError("'resources' is gone: counters go in a section, as its `counters` (the same name: max mapping)")
  }

  const warnings = Object.keys(data).filter((key) => !KNOWN_FIELDS.has(key)).map((key) => `Unknown field '${key}'`)
  if (document) {
    for (const key of DOCUMENT_FIELDS) {
      if (key in data) warnings.push(`'${key}' is ignored here: the sheet's ${key} is its document's`)
    }
    data = { ...Object.fromEntries(Object.entries(data).filter(([key]) => !DOCUMENT_FIELDS.includes(key))), name: document.name, type: document.type }
  }

  const name = text(data.name)
  if (!name) throw new SheetParseError('A sheet needs a name')
  const type = (text(data.type) || 'adversary').toLowerCase()
  if (!SHEET_TYPES.includes(type)) throw new SheetParseError(`type must be one of: ${SHEET_TYPES.join(', ')}`)

  const explicitId = document?.id || slugify(text(data.id) || '')
  const id = explicitId || slugify(name)
  if (!id) throw new SheetParseError("The sheet's id needs at least one letter or number")
  if (type === 'character' && !explicitId) {
    warnings.push('A character should declare a stable id: its saved values are kept under it')
  }
  const [image, imageWarning] = normalizeImage(data.image)
  if (imageWarning) warnings.push(imageWarning)
  const parts = sections(data.sections)

  return {
    sheet: {
      id,
      name,
      type,
      subtitle: text(data.subtitle),
      image,
      tags: tags(data.tags),
      resources: parts.resources,
      stats: stats(data.stats),
      sections: parts.sections,
      columns: columns(data.columns, 'columns'),
      text: text(data.text)
    },
    warnings
  }
}

/** The sheet a character or adversary document describes: { sheet, warnings }. */
export function parseSheetDoc(doc, type) {
  return parseSheetSource(doc.source || '', { name: doc.name || '', id: doc.id, type })
}

/** What a new sheet's editor offers to start from. */
export const SHEET_TEMPLATES = {
  adversary: [
    '# A template: each copy in an encounter has its own values.',
    'subtitle:',
    'image:                   # URL of an Observatory image',
    'tags: []',
    'sections:',
    '  - counters:            # counters, by name: HP: 6 (a section without a title opens the sheet)',
    '      HP: 6',
    '      Stress: { max: 3, start: 0 }',
    '    stats:',
    '      Difficulty: 12',
    '  - title: Actions',
    '    items:',
    '      - name: Attack',
    '        roll: 1d20+3',
    '        text: What it does. Dice in text work too, like `1d8+2`.',
    ''
  ].join('\n'),
  character: [
    '# One individual: its counters keep their values, here and in every encounter.',
    'subtitle:',
    'image:                   # URL of an Observatory image',
    'sections:',
    '  - counters:',
    '      HP: 10',
    '      Stress: { max: 5, start: 0 }',
    '    stats:',
    '      Defense: 10',
    '  - title: Actions',
    '    items:',
    '      - name: Attack',
    '        roll: 1d20+3',
    ''
  ].join('\n')
}
