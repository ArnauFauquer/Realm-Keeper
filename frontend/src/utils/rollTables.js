// Roll tables: a markdown table whose first header cell is a die rolls on
// itself. `d20` throws a d20 and picks the row whose first cell holds the
// result (`7`, `2-3`, `96-00`, `11+`); rows without numbers are counted from
// 1. A bare `d` sizes the die to the table. A die there is no physical body
// for (`d7`, `d3`) is rolled as a plain random number instead.
import { parseDiceFormula } from './diceNotation'

const AUTO_HEADER = 'd'
const VIRTUAL_RE = /^(\d*)d(\d+)$/
const RANGE_RE = /^(\d+)\s*(?:[-–—]\s*(\d+)|(\+))?$/

/**
 * What a table's first header cell asks to roll: { auto: true } for a bare
 * `d`, { formula } for any die, or null for an ordinary table. Backticks and
 * emphasis around it (`` `d20` ``, `**d6**`) are ignored.
 */
export function parseRollHeader(text) {
  const clean = String(text ?? '').replace(/[`*_]/g, '').trim().toLowerCase()
  if (clean === AUTO_HEADER) return { auto: true }
  if (parseDiceFormula(clean) || virtualDie(clean)) return { formula: clean }
  return null
}

/** { count, sides } for a plain NdM with no physical die, e.g. "d7". */
function virtualDie(formula) {
  const match = VIRTUAL_RE.exec(formula)
  if (!match) return null
  const count = match[1] ? parseInt(match[1], 10) : 1
  const sides = parseInt(match[2], 10)
  if (count < 1 || count > 100 || sides < 2 || sides > 10000) return null
  return { count, sides }
}

/**
 * The results a row's first cell covers: "7" -> 7..7, "2-3" -> 2..3,
 * "11+" -> 11 and up (max null). "00" is the 100 of a percentile die.
 */
export function parseRowRange(text) {
  const match = RANGE_RE.exec(String(text ?? '').replace(/[`*_]/g, '').trim())
  if (!match) return null
  const read = (value) => (value === '00' ? 100 : parseInt(value, 10))
  const min = read(match[1])
  if (match[3]) return { min, max: null }
  const max = match[2] !== undefined ? read(match[2]) : min
  return max >= min ? { min, max } : null
}

/**
 * How a table rolls, from its header cell and the first cell of each body
 * row: { formula, virtual, ranges } (virtual = rolled as a random number,
 * ranges[i] = { min, max } of row i), or null for an ordinary table. Rows
 * are matched by their numbers when every one has them, by position
 * otherwise.
 */
export function planRollTable(headerText, firstCells) {
  const header = parseRollHeader(headerText)
  if (!header || !firstCells.length) return null

  const numbered = firstCells.map(parseRowRange)
  const ranges = numbered.every(Boolean)
    ? numbered
    : firstCells.map((cell, i) => ({ min: i + 1, max: i + 1 }))

  let formula = header.formula
  if (header.auto) {
    const top = Math.max(...ranges.map(r => r.max ?? r.min))
    formula = `d${Math.max(top, 2)}`
  }
  return { formula, virtual: !parseDiceFormula(formula), ranges }
}

/** Rolls a die with no physical body: { total, groups, flatModifier } in
 * the shape a physical roll returns, so it shows in the same toast. */
export function rollVirtual(formula, random = secureRandom) {
  const die = virtualDie(formula)
  if (!die) return null
  const rolls = Array.from({ length: die.count }, () => 1 + Math.floor(random() * die.sides))
  return {
    total: rolls.reduce((sum, v) => sum + v, 0),
    groups: [{ sides: die.sides, sign: 1, rolls }],
    flatModifier: 0
  }
}

function secureRandom() {
  const buf = new Uint32Array(1)
  crypto.getRandomValues(buf)
  return buf[0] / 2 ** 32
}

/** Index of the range that holds `total`, or -1. */
export function findRangeIndex(ranges, total) {
  return ranges.findIndex(r => total >= r.min && (r.max == null || total <= r.max))
}

/** The HTML for a roll table's header die (escape = markdown-it's escapeHtml). */
export function renderRollHeader(formula, escape) {
  const f = escape(formula)
  return `<span class="roll-table-die" data-roll-table="${f}" role="button" tabindex="0" title="Roll ${f} on this table">` +
    `<span class="mdi mdi-dice-multiple"></span><span class="roll-table-formula">${f}</span></span>`
}

/**
 * markdown-it core rule: marks every roll table (class `roll-table`, the
 * formula on its header die, `data-roll-virtual` when it has no physical
 * die) and each body row with the results it covers (`data-roll-min` /
 * `data-roll-max`, no max for an open "11+" row).
 */
export function rollTablesPlugin(md) {
  md.core.ruler.push('roll_tables', (state) => {
    const tokens = state.tokens
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type !== 'table_open') continue
      const table = collectTable(tokens, i)
      i = table.end
      if (!table.header) continue
      const plan = planRollTable(table.header.content, table.rows.map(r => r.firstCell?.content ?? ''))
      if (!plan) continue

      tokens[table.start].attrJoin('class', 'roll-table')
      if (plan.virtual) tokens[table.start].attrSet('data-roll-virtual', '')
      const chip = new state.Token('html_inline', '', 0)
      chip.content = renderRollHeader(plan.formula, md.utils.escapeHtml)
      table.header.children = [chip]
      table.rows.forEach(({ tr }, r) => {
        tr.attrSet('data-roll-min', String(plan.ranges[r].min))
        if (plan.ranges[r].max != null) tr.attrSet('data-roll-max', String(plan.ranges[r].max))
      })
    }
  })
}

// The tokens of the table opening at `start`: its first header cell's inline
// token, and each body row's tr_open with the inline token of its first cell.
function collectTable(tokens, start) {
  let header = null
  const rows = []
  let inBody = false
  let row = null
  let end = start
  for (let j = start + 1; j < tokens.length; j++) {
    const t = tokens[j]
    if (t.type === 'table_close') { end = j; break }
    if (t.type === 'tbody_open') inBody = true
    else if (t.type === 'tr_open' && inBody) { row = { tr: t, firstCell: null }; rows.push(row) }
    else if (t.type === 'inline') {
      if (!inBody && !header) header = t
      else if (inBody && row && !row.firstCell) row.firstCell = t
    }
  }
  return { start, end, header, rows }
}

/** The ranges a rendered roll table's rows were marked with. */
export function readRowRanges(rows) {
  return rows.map(tr => ({
    min: Number(tr.getAttribute('data-roll-min')),
    max: tr.hasAttribute('data-roll-max') ? Number(tr.getAttribute('data-roll-max')) : null
  }))
}

/** What a rolled row says (every cell after the die's), for the toast. */
export function rowOutcome(tr, total) {
  if (!tr) return `No row for ${total}`
  const text = [...tr.cells].slice(1).map(td => td.textContent.trim()).filter(Boolean).join(' · ')
  return text || null
}
