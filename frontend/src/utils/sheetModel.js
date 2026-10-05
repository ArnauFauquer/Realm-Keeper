// A sheet (the JSON a character or adversary document keeps) as the sheet
// builder edits it, and back. While it is being built a sheet has rows still
// without a name (a counter, a stat, an empty entry); bodyFromModel leaves
// them out, so what is saved is always the clean sheet the server stores
// (backend/models/sheet.py SheetBody), every field present.

/** How many columns the builder offers (a sheet may ask for up to 12). */
export const COLUMN_CHOICES = [1, 2, 3, 4, 5, 6]
export const COUNTER_DISPLAYS = ['pips', 'bar', 'number']

export const newCounter = () => ({ name: '', max: 6, min: 0, start: null, color: null, style: null })
export const newStat = () => ({ label: '', value: '', roll: null })
export const newStatGroup = () => ({ title: null, columns: null, stats: [newStat()] })
export const newItem = () => ({ name: '', text: '', roll: null, tags: [], cost: null })
export const newSection = (title = '') => ({
  title,
  columns: null,
  wide: false,
  collapsed: false,
  tab: null,
  counters: [],
  stats: [],
  items: []
})

/** An editable copy of a sheet, every field there to bind a form to. */
export function modelFromBody(body) {
  const sheet = body || {}
  return {
    subtitle: sheet.subtitle ?? null,
    image: sheet.image ?? null,
    tags: [...(sheet.tags || [])],
    columns: sheet.columns ?? null,
    text: sheet.text ?? null,
    sections: (sheet.sections || []).map((section) => ({
      ...newSection(section.title ?? null),
      columns: section.columns ?? null,
      wide: section.wide === true,
      collapsed: section.collapsed === true,
      tab: section.tab ?? null,
      counters: (section.counters || []).map((counter) => ({ ...newCounter(), ...counter })),
      stats: (section.stats || []).map((group) => ({
        title: group.title ?? null,
        columns: group.columns ?? null,
        stats: (group.stats || []).map((stat) => ({ ...newStat(), ...stat, value: stat.value ?? '' }))
      })),
      items: (section.items || []).map((item) => ({ ...newItem(), ...item, tags: [...(item.tags || [])] }))
    }))
  }
}

const clean = (value) => {
  if (value === null || value === undefined) return null
  const trimmed = String(value).trim()
  return trimmed || null
}

/** A stat's value as typed: a whole number is kept as one (12, not "12"). */
export function statInput(typed) {
  const value = clean(typed)
  if (value === null) return ''
  return /^-?\d{1,15}$/.test(value) ? Number(value) : typed
}

const statValue = (value) => (typeof value === 'number' ? value : clean(value))
const tagList = (tags) => [...new Set((tags || []).map(clean).filter(Boolean))]

/** The sheet a builder model saves as. */
export function bodyFromModel(model) {
  return {
    subtitle: clean(model.subtitle),
    image: clean(model.image),
    tags: tagList(model.tags),
    columns: model.columns || null,
    text: clean(model.text),
    sections: model.sections.map((section) => ({
      title: clean(section.title),
      columns: section.columns || null,
      wide: !!section.wide,
      collapsed: !!section.collapsed && !!clean(section.title),
      tab: clean(section.tab),
      counters: section.counters
        .filter((counter) => clean(counter.name))
        .map((counter) => ({
          name: clean(counter.name),
          max: counter.max,
          min: counter.min ?? 0,
          start: counter.start ?? null,
          color: clean(counter.color),
          style: counter.style || null
        })),
      stats: section.stats
        .map((group) => ({
          title: clean(group.title),
          columns: group.columns || null,
          stats: group.stats
            .filter((stat) => clean(stat.label))
            .map((stat) => ({ label: clean(stat.label), value: statValue(stat.value), roll: clean(stat.roll) }))
        }))
        .filter((group) => group.title || group.stats.length),
      items: section.items
        .map((item) => ({
          name: clean(item.name),
          text: item.text && String(item.text).trim() ? String(item.text).trim() : null,
          roll: clean(item.roll),
          tags: tagList(item.tags),
          cost: clean(item.cost)
        }))
        .filter((item) => item.name || item.text || item.roll || item.cost || item.tags.length)
    }))
  }
}

/** A sheet as it would be saved: two sheets are the same when these match. */
export const normalizeBody = (body) => bodyFromModel(modelFromBody(body))
export const sameSheet = (a, b) => JSON.stringify(normalizeBody(a)) === JSON.stringify(normalizeBody(b))
