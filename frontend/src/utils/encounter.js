// What goes into an encounter when a sheet is added: the same copy whether the
// sheet is a catalog entry (GET /api/sheets) or one a note is showing.
import { counterStart } from './sheet'

const LIBRARY_PREFIX = '/api/observatory/images/'

/** A counter as the live documents keep it: its definition plus where it stands. */
export function counterFromSpec(spec) {
  return {
    current: counterStart(spec),
    max: spec.max,
    min: spec.min ?? 0,
    color: spec.color ?? null,
    style: spec.style ?? null
  }
}

function counters(resources) {
  return Object.fromEntries(Object.entries(resources || {}).map(([name, spec]) => [name, counterFromSpec(spec)]))
}

// Combatants and tokens may only draw Observatory images (others can't be fetched
// on a screen's behalf); a sheet's image can be any URL.
const libraryImage = (image) => (image && image.startsWith(LIBRARY_PREFIX) ? image : null)

/**
 * `count` combatants for an encounter, from a sheet ({ ref, id, name, type,
 * image, resources }; `ref`, or else `id`, is its document's id). Each copy of an adversary has its own counters,
 * starting where the sheet says; they are named "Bugboar 1", "Bugboar 2"...
 * continuing from the ones already there. A character is added once, and has
 * no counters of its own: they are the character's saved ones.
 * `existing` is the encounter's combatants.
 */
export function combatantsFromSheet(sheet, count, existing = []) {
  const image_url = libraryImage(sheet.image)
  if (sheet.type === 'character') {
    return [{ name: sheet.name, type: 'character', sheet: sheet.ref ?? sheet.id, image_url }]
  }
  const ref = sheet.ref ?? sheet.id
  const taken = existing.filter((c) => c.type !== 'character' && c.sheet === ref).length
  return Array.from({ length: count }, (_, i) => ({
    name: taken === 0 && count === 1 ? sheet.name : `${sheet.name} ${taken + i + 1}`,
    type: 'adversary',
    sheet: ref,
    resources: counters(sheet.resources),
    image_url
  }))
}

/** A combatant that isn't from a sheet. */
export function customCombatant(name) {
  return { name, type: 'adversary', resources: {} }
}

/**
 * `ids` with `id` taken out and put back just before the entry that was at
 * `index` (0 to ids.length: the one past the end is "last"). The order of an
 * encounter is the table's own, so this is all the ordering there is.
 */
export function moveBefore(ids, id, index) {
  const from = ids.indexOf(id)
  if (from === -1) return ids
  const rest = ids.filter((other) => other !== id)
  rest.splice(from < index ? index - 1 : index, 0, id)
  return rest
}
