// A ```sheet block in a note (YAML) turned into the normalized shape the
// sheet component renders. backend/services/sheet_parser.py does the same
// normalization for the catalog; both are checked against the shared cases in
// backend/tests/fixtures/sheets/, so a change here needs the same change there.
import { parse } from 'yaml'

export const SHEET_TYPES = ['character', 'adversary']

// Same limit as the backend (services/sheet_parser.py), and no aliases for the
// same reason: a few nested ones expand to gigabytes.
const MAX_SOURCE_LENGTH = 100_000

const KNOWN_FIELDS = new Set(['id', 'name', 'type', 'subtitle', 'image', 'tags', 'resources', 'stats', 'sections', 'text'])
const ASSET_URL_PREFIX = '/api/asset-library/assets/'
const ASSET_KEY_PREFIX = 'asset-library/'

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

/** [url, warning]: a library image is kept as the app's relative URL, so one
 * pasted with the site's address in front still matches. */
export function normalizeImage(value) {
  const image = text(value)
  if (!image) return [null, null]
  const marker = image.indexOf(ASSET_URL_PREFIX)
  if (marker !== -1) return [image.slice(marker), null]
  if (image.startsWith(ASSET_KEY_PREFIX)) return [ASSET_URL_PREFIX + image, null]
  if (/^https?:\/\//i.test(image)) return [image, null]
  return [null, 'image must be the URL of an asset library image, as copied from the library']
}

function integer(value, what) {
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new SheetParseError(`${what} must be a whole number`)
  return value
}

function resource(name, raw) {
  let spec
  if (isMapping(raw)) {
    if (!('max' in raw)) throw new SheetParseError(`resource '${name}' needs a max`)
    spec = {
      max: integer(raw.max, `resource '${name}' max`),
      min: integer(raw.min ?? 0, `resource '${name}' min`),
      start: raw.start === null || raw.start === undefined ? null : integer(raw.start, `resource '${name}' start`),
      color: text(raw.color),
      style: text(raw.style)
    }
  } else {
    spec = { max: integer(raw, `resource '${name}'`), min: 0, start: null, color: null, style: null }
  }
  if (spec.min > spec.max) throw new SheetParseError(`resource '${name}' has a min above its max`)
  return spec
}

function resources(raw) {
  if (raw === null || raw === undefined) return {}
  if (!isMapping(raw)) throw new SheetParseError('resources must be a mapping of name to maximum, e.g. HP: 6')
  return Object.fromEntries(Object.entries(raw).map(([name, value]) => [name, resource(name, value)]))
}

function stats(raw) {
  if (raw === null || raw === undefined) return []
  if (!isMapping(raw)) throw new SheetParseError('stats must be a mapping of label to value')
  return Object.entries(raw).map(([label, value]) =>
    isMapping(value)
      ? { label, value: value.value ?? null, roll: text(value.roll) }
      : { label, value: value ?? null, roll: null }
  )
}

function item(raw) {
  if (isMapping(raw)) {
    return { name: text(raw.name), text: text(raw.text), roll: text(raw.roll), tags: tags(raw.tags), cost: text(raw.cost) }
  }
  return { name: null, text: text(raw), roll: null, tags: [], cost: null }
}

function sections(raw) {
  if (raw === null || raw === undefined) return []
  if (!Array.isArray(raw) || !raw.every(isMapping)) {
    throw new SheetParseError('sections must be a list, each with a title and its items')
  }
  return raw.map((section) => {
    if (section.items !== null && section.items !== undefined && !Array.isArray(section.items)) {
      throw new SheetParseError("a section's items must be a list")
    }
    return { title: text(section.title), items: (section.items || []).map(item) }
  })
}

/** { sheet, warnings } for a block's YAML. Throws SheetParseError, whose
 * message is meant for the note's author. */
export function parseSheetSource(source) {
  if (source.length > MAX_SOURCE_LENGTH) throw new SheetParseError(`A sheet can't be longer than ${MAX_SOURCE_LENGTH / 1000} KB`)
  let data
  try {
    data = parse(source, { maxAliasCount: 0 })
  } catch (e) {
    throw new SheetParseError(`Invalid YAML: ${e.message.split('\n')[0]}`)
  }
  if (!isMapping(data)) throw new SheetParseError('A sheet must be a YAML mapping (name: ..., resources: ...)')

  const name = text(data.name)
  if (!name) throw new SheetParseError('A sheet needs a name')
  const type = (text(data.type) || 'adversary').toLowerCase()
  if (!SHEET_TYPES.includes(type)) throw new SheetParseError(`type must be one of: ${SHEET_TYPES.join(', ')}`)

  const warnings = Object.keys(data).filter((key) => !KNOWN_FIELDS.has(key)).map((key) => `Unknown field '${key}'`)
  const explicitId = slugify(text(data.id) || '')
  const id = explicitId || slugify(name)
  if (!id) throw new SheetParseError("The sheet's id needs at least one letter or number")
  if (type === 'character' && !explicitId) {
    warnings.push('A character should declare a stable id: its saved values are kept under it')
  }
  const [image, imageWarning] = normalizeImage(data.image)
  if (imageWarning) warnings.push(imageWarning)

  return {
    sheet: {
      id,
      name,
      type,
      subtitle: text(data.subtitle),
      image,
      tags: tags(data.tags),
      resources: resources(data.resources),
      stats: stats(data.stats),
      sections: sections(data.sections),
      text: text(data.text)
    },
    warnings
  }
}

/** Snippets the note editor inserts. The comments are YAML, not tags: fenced
 * blocks are never scanned for tags. */
export const SHEET_TEMPLATES = {
  adversary: [
    '```sheet',
    'name: New adversary',
    'type: adversary          # a template: each copy in an encounter has its own values',
    'subtitle:',
    'image:                   # URL of an asset library image',
    'tags: []',
    'resources:               # counters, by name: HP: 6',
    '  HP: 6',
    '  Stress: { max: 3, start: 0 }',
    'stats:',
    '  Difficulty: 12',
    'sections:',
    '  - title: Actions',
    '    items:',
    '      - name: Attack',
    '        roll: 1d20+3',
    '        text: What it does. Dice in text work too, like `1d8+2`.',
    '```'
  ].join('\n'),
  character: [
    '```sheet',
    'name: New character',
    'id: new-character        # keep it stable: the saved values are kept under it',
    'type: character          # one individual: its current values persist',
    'subtitle:',
    'image:                   # URL of an asset library image',
    'resources:',
    '  HP: 10',
    '  Stress: { max: 5, start: 0 }',
    'stats:',
    '  Defense: 10',
    'sections:',
    '  - title: Actions',
    '    items:',
    '      - name: Attack',
    '        roll: 1d20+3',
    '```'
  ].join('\n')
}
