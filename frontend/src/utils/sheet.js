// A character's or an adversary's sheet: the JSON its document keeps
// (`sheet`, what the sheet builder edits) turned into the shape the sheet
// component draws. backend/services/sheet_parser.py spec_from_body does the
// same; both are checked against the shared cases in
// backend/tests/fixtures/sheet-bodies/, so a change here needs the same there.
import { OBSERVATORY_IMAGE_PREFIX } from '@/utils/docTypes'

export const SHEET_TYPES = ['character', 'adversary']

/** How many columns a layout may ask for (the sheet's sections, a section's
 * entries, a group of stats). Narrow screens fall back to fewer on their own. */
export const MAX_COLUMNS = 12
/** A character keeps a saved value per counter. */
export const MAX_COUNTERS = 24

// An Observatory image's file name: its uid (lower-case hex, as the backend
// gives and reads it), then its name with an image's extension, in any case
// ("1a2b3c4d-boar.PNG").
const IMAGE_FILE_NAME = /^[0-9a-f]{8}-[^/]+\.(png|jpe?g|webp|gif|svg)$/
const isImageFileName = (name) => {
  const dot = name.lastIndexOf('.')
  return dot !== -1 && IMAGE_FILE_NAME.test(name.slice(0, dot) + name.slice(dot).toLowerCase())
}

function text(value) {
  if (value === null || value === undefined) return null
  const trimmed = String(value).trim()
  return trimmed || null
}

// Quoted as the backend quotes it (Python's quote(name, safe="")), so both
// sides make the same URL of a file name.
const quoteName = (name) =>
  encodeURIComponent(name).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)

/** [url, warning]: an Observatory image is kept as the app's relative URL, so
 * one given with the site's address in front (or as its bare file name) still matches. */
export function normalizeImage(value) {
  const image = text(value)
  if (!image) return [null, null]
  const marker = image.indexOf(OBSERVATORY_IMAGE_PREFIX)
  if (marker !== -1) return [image.slice(marker), null]
  if (isImageFileName(image)) return [OBSERVATORY_IMAGE_PREFIX + quoteName(image), null]
  if (/^https?:\/\//i.test(image)) return [image, null]
  return [null, 'image must be the URL of an Observatory image, as copied from the Observatory']
}

const counterSpec = (counter) => ({
  max: counter.max,
  min: counter.min ?? 0,
  start: counter.start ?? null,
  color: counter.color ?? null,
  style: counter.style ?? null
})

const group = (raw) => ({
  title: raw.title ?? null,
  columns: raw.columns ?? null,
  stats: (raw.stats || []).map((stat) => ({ label: stat.label, value: stat.value ?? null, roll: stat.roll ?? null }))
})

const item = (raw) => ({
  name: raw.name ?? null,
  text: raw.text ?? null,
  roll: raw.roll ?? null,
  tags: raw.tags || [],
  cost: raw.cost ?? null
})

/**
 * { sheet, warnings }: the sheet a character or adversary document describes,
 * as it is drawn. Its counters are gathered by name into `resources` (what
 * encounters and saved characters go by), and each section names its own.
 */
export function sheetFromDoc(doc, type) {
  const body = doc.sheet || {}
  const warnings = []
  const [image, imageWarning] = normalizeImage(body.image)
  if (imageWarning) warnings.push(imageWarning)
  const resources = {}
  const sections = (body.sections || []).map((section) => {
    for (const counter of section.counters || []) resources[counter.name] = counterSpec(counter)
    return {
      title: section.title ?? null,
      columns: section.columns ?? null,
      wide: section.wide === true,
      collapsed: section.collapsed === true,
      tab: section.tab ?? null,
      counters: (section.counters || []).map((counter) => counter.name),
      stats: (section.stats || []).map(group),
      items: (section.items || []).map(item)
    }
  })
  return {
    sheet: {
      id: doc.id || '',
      name: doc.name || doc.id || '',
      type,
      subtitle: body.subtitle ?? null,
      image,
      tags: body.tags || [],
      resources,
      stats: [],
      sections,
      columns: body.columns ?? null,
      text: body.text ?? null
    },
    warnings
  }
}

/** Where a counter of a sheet starts: its `start`, or its max, within its
 * range. A sheet keeps `start` as written (`{ max: 3, start: 9 }`), and the
 * backend starts such a counter at 3 (services/sheet_docs.py), so this does too. */
export function counterStart(spec) {
  const min = spec.min ?? 0
  return Math.max(min, Math.min(spec.max, spec.start ?? spec.max))
}

/** What is wrong with a sheet, for its author: the server refuses it as long
 * as there is something here. */
export function sheetProblems(body) {
  const problems = []
  const seen = new Set()
  let count = 0
  for (const section of body.sections || []) {
    for (const counter of section.counters || []) {
      count++
      if (seen.has(counter.name)) problems.push(`Two counters are called "${counter.name}": each one needs its own name.`)
      seen.add(counter.name)
      if (counter.min > counter.max) problems.push(`"${counter.name}" has a minimum above its maximum.`)
    }
  }
  if (count > MAX_COUNTERS) problems.push(`A sheet can have at most ${MAX_COUNTERS} counters.`)
  return [...new Set(problems)]
}
