// A sheet's YAML (a character's or an adversary's `source`) turned into the
// normalized shape the sheet component renders. backend/services/sheet_parser.py
// does the same normalization; both are checked against the shared cases in
// backend/tests/fixtures/sheets/, so a change here needs the same change there.
// The YAML is read as the backend reads it (utils/pythonYaml.js), and turned
// into text as Python would: the backend stores the sheet, so what it makes of
// `wide: yes` or `subtitle: 1.0` is what the sheet says.
import { PyDict, PyFloat, YamlError, loadYaml, pyStr, pyStrip, toJson } from './pythonYaml'
import { OBSERVATORY_IMAGE_PREFIX as IMAGE_URL_PREFIX } from './docTypes'

export const SHEET_TYPES = ['character', 'adversary']

// Same limit as the backend (services/sheet_parser.py), in characters as
// Python counts them (an emoji is one), and no aliases for the same reason: a
// few nested ones expand to gigabytes.
const MAX_SOURCE_LENGTH = 100_000
// What an encounter or a character may hold (models/encounter.py,
// ResourceState and Combatant): a sheet with more would parse and then not fit.
export const MAX_COUNTERS = 24
const MAX_COLOR_LENGTH = 40
const MAX_STYLE_LENGTH = 20

const KNOWN_FIELDS = new Set(['id', 'name', 'type', 'subtitle', 'image', 'tags', 'stats', 'sections', 'columns', 'text'])
// How many columns a layout may ask for (the sheet's sections, a section's
// items, a group of stats). Narrow screens fall back to fewer on their own.
const MAX_COLUMNS = 12
// An Observatory image's file name: its uid (lower-case hex, as uploads are
// named), then its name ("1a2b3c4d-boar.png").
const IMAGE_FILE_NAME = /^[0-9a-f]{8}-[^\n]+$/
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'])
const extension = (name) => (name.includes('.') ? name.slice(name.lastIndexOf('.')).toLowerCase() : '')

export class SheetParseError extends Error {}

const isMapping = (value) => value instanceof PyDict
const isAbsent = (value) => value === null || value === undefined
// Lengths in characters as Python counts them: a character outside the BMP
// (an emoji) is two UTF-16 units but one character.
const codePoints = (text) => text.length - (text.match(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g)?.length || 0)

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
  if (isAbsent(value)) return null
  const trimmed = pyStrip(pyStr(value))
  return trimmed || null
}

function tags(value) {
  if (isAbsent(value)) return []
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
  if (IMAGE_FILE_NAME.test(image) && IMAGE_EXTENSIONS.has(extension(image)) && !image.includes('/')) {
    return [IMAGE_URL_PREFIX + quoteName(image), null]
  }
  if (/^https?:\/\//i.test(image)) return [image, null]
  return [null, 'image must be the URL of an Observatory image, as copied from the Observatory']
}

// A whole number: an int, or a float with nothing after the point (`6.0`),
// never a boolean.
function integer(value, what) {
  if (typeof value === 'number' || typeof value === 'bigint') return Number(value)
  if (value instanceof PyFloat && Number.isInteger(value.value)) return value.value
  throw new SheetParseError(`${what} must be a whole number`)
}

function counter(name, raw) {
  let spec
  if (isMapping(raw)) {
    if (!raw.has('max')) throw new SheetParseError(`counter '${name}' needs a max`)
    // `min: ~` is a min that isn't a number, not a missing one.
    spec = {
      max: integer(raw.get('max'), `counter '${name}' max`),
      min: raw.has('min') ? integer(raw.get('min'), `counter '${name}' min`) : 0,
      start: isAbsent(raw.get('start')) ? null : integer(raw.get('start'), `counter '${name}' start`),
      color: text(raw.get('color')),
      style: text(raw.get('style'))
    }
  } else {
    spec = { max: integer(raw, `counter '${name}'`), min: 0, start: null, color: null, style: null }
  }
  if (spec.min > spec.max) throw new SheetParseError(`counter '${name}' has a min above its max`)
  if (spec.color && codePoints(spec.color) > MAX_COLOR_LENGTH) {
    throw new SheetParseError(`counter '${name}' color can't be longer than ${MAX_COLOR_LENGTH} characters`)
  }
  if (spec.style && codePoints(spec.style) > MAX_STYLE_LENGTH) {
    throw new SheetParseError(`counter '${name}' style can't be longer than ${MAX_STYLE_LENGTH} characters`)
  }
  return spec
}

/** A Map of name to counter, in the order they were written (a Map, since an
 * object would put names that look like numbers first). Two keys that are
 * the same text (1 and '1') are one counter, the last one, as in Python. */
function counters(raw) {
  if (isAbsent(raw)) return new Map()
  if (!isMapping(raw)) throw new SheetParseError("a section's counters must be a mapping of name to maximum, e.g. HP: 6")
  const own = new Map()
  for (const [key, value] of raw.entries()) {
    const name = pyStr(key)
    own.set(name, counter(name, value))
  }
  return own
}

function columns(value, what) {
  if (isAbsent(value)) return null
  const n = integer(value, what)
  if (n < 1 || n > MAX_COLUMNS) throw new SheetParseError(`${what} must be between 1 and ${MAX_COLUMNS}`)
  return n
}

function statList(raw) {
  return raw.entries().map(([label, value]) =>
    isMapping(value)
      ? { label: pyStr(label), value: toJson(value.get('value')), roll: text(value.get('roll')) }
      : { label: pyStr(label), value: toJson(value), roll: null }
  )
}

// A group is either a plain mapping of stats, or { title, columns, stats }
// (told apart by having a `stats` key).
function statGroup(raw) {
  if (!isMapping(raw)) throw new SheetParseError('each group of stats must be a mapping of label to value')
  if (raw.has('stats')) {
    const list = raw.get('stats')
    if (!isMapping(list)) throw new SheetParseError("a stat group's stats must be a mapping of label to value")
    return { title: text(raw.get('title')), columns: columns(raw.get('columns'), "a stat group's columns"), stats: statList(list) }
  }
  return { title: null, columns: null, stats: statList(raw) }
}

/** Always a list of groups: a single mapping is one untitled group. */
function stats(raw) {
  if (isAbsent(raw)) return []
  if (Array.isArray(raw)) return raw.map(statGroup)
  if (!isMapping(raw)) throw new SheetParseError('stats must be a mapping of label to value, or a list of groups of them')
  return raw.size ? [statGroup(raw)] : []
}

function item(raw) {
  if (isMapping(raw)) {
    return {
      name: text(raw.get('name')),
      text: text(raw.get('text')),
      roll: text(raw.get('roll')),
      tags: tags(raw.get('tags')),
      cost: text(raw.get('cost'))
    }
  }
  return { name: null, text: text(raw), roll: null, tags: [], cost: null }
}

/** { sections, resources }: each section names its counters, and every
 * counter of the sheet is also in `resources` (by name, in order), which is
 * what encounters and saved characters go by. */
function sections(raw) {
  if (isAbsent(raw)) return { sections: [], resources: {} }
  if (!Array.isArray(raw) || !raw.every(isMapping)) {
    throw new SheetParseError('sections must be a list, each with a title and its items')
  }
  const resources = new Map()
  const list = raw.map((section) => {
    const items = section.get('items')
    if (!isAbsent(items) && !Array.isArray(items)) throw new SheetParseError("a section's items must be a list")
    const own = counters(section.get('counters'))
    for (const [name, spec] of own) {
      if (resources.has(name)) throw new SheetParseError(`counter '${name}' is defined twice: counter names must be unique in a sheet`)
      resources.set(name, spec)
    }
    return {
      title: text(section.get('title')),
      columns: columns(section.get('columns'), "a section's columns"),
      wide: section.get('wide') === true,
      collapsed: section.get('collapsed') === true,
      tab: text(section.get('tab')),
      counters: [...own.keys()],
      stats: stats(section.get('stats')),
      items: (items || []).map(item)
    }
  })
  if (resources.size > MAX_COUNTERS) throw new SheetParseError(`a sheet can't have more than ${MAX_COUNTERS} counters`)
  return { sections: list, resources: Object.fromEntries(resources) }
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
  if (source.length > MAX_SOURCE_LENGTH && codePoints(source) > MAX_SOURCE_LENGTH) {
    throw new SheetParseError(`A sheet can't be longer than ${MAX_SOURCE_LENGTH / 1000} KB`)
  }
  let data
  try {
    data = loadYaml(source)
  } catch (e) {
    if (!(e instanceof YamlError)) throw e
    throw new SheetParseError(`Invalid YAML: ${e.message}`)
  }
  if (isAbsent(data) && document) data = new PyDict()
  if (!isMapping(data)) throw new SheetParseError('A sheet must be a YAML mapping (subtitle: ..., sections: ...)')
  if (data.has('resources')) {
    throw new SheetParseError("'resources' is gone: counters go in a section, as its `counters` (the same name: max mapping)")
  }

  const warnings = data
    .entries()
    .map(([key]) => pyStr(key))
    .filter((key) => !KNOWN_FIELDS.has(key))
    .map((key) => `Unknown field '${key}'`)
  // A field of the sheet, by name. In a document, its name, id and type are
  // the document's.
  let get = (key) => data.get(key)
  if (document) {
    for (const key of DOCUMENT_FIELDS) {
      if (data.has(key)) warnings.push(`'${key}' is ignored here: the sheet's ${key} is its document's`)
    }
    const own = { name: document.name, type: document.type, id: null }
    get = (key) => (key in own ? own[key] : data.get(key))
  }

  const name = text(get('name'))
  if (!name) throw new SheetParseError('A sheet needs a name')
  const type = (text(get('type')) || 'adversary').toLowerCase()
  if (!SHEET_TYPES.includes(type)) throw new SheetParseError(`type must be one of: ${SHEET_TYPES.join(', ')}`)

  const explicitId = document?.id || slugify(text(get('id')) || '')
  const id = explicitId || slugify(name)
  if (!id) throw new SheetParseError("The sheet's id needs at least one letter or number")
  if (type === 'character' && !explicitId) {
    warnings.push('A character should declare a stable id: its saved values are kept under it')
  }
  const [image, imageWarning] = normalizeImage(get('image'))
  if (imageWarning) warnings.push(imageWarning)
  const parts = sections(get('sections'))

  return {
    sheet: {
      id,
      name,
      type,
      subtitle: text(get('subtitle')),
      image,
      tags: tags(get('tags')),
      resources: parts.resources,
      stats: stats(get('stats')),
      sections: parts.sections,
      columns: columns(get('columns'), 'columns'),
      text: text(get('text'))
    },
    warnings
  }
}

/** Where a counter of a sheet starts: its `start`, or its max, within its
 * range. The parser keeps `start` as written (`{ max: 3, start: 9 }`), and the
 * backend starts such a counter at 3 (services/sheet_docs.py), so this does too. */
export function counterStart(spec) {
  const min = spec.min ?? 0
  return Math.max(min, Math.min(spec.max, spec.start ?? spec.max))
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
