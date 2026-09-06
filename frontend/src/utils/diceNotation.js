// Dice notation parser, e.g. "4d8+5", "2d20-1", "1d100", "d%", "d2".
// Shared by the note-rendering code-span hook and the manual formula field
// in DicePanel, so both validate against exactly the same grammar.
const SUPPORTED_SIDES = [2, 4, 6, 8, 10, 12, 20, 100]

const TERM_RE = /([+-]?)\s*(?:(\d*)d(\d+|%)|(\d+))/gi

/**
 * Parses a dice formula into { formula, terms, flatModifier } or returns
 * null if the string contains anything outside the supported grammar
 * (unsupported die size, stray characters, etc).
 *
 * terms: [{ count, sides, sign }] - one entry per NdM group, sign is 1|-1.
 * flatModifier: sum of all bare-number terms (already sign-applied).
 */
export function parseDiceFormula(text) {
  if (typeof text !== 'string') return null
  const trimmed = text.trim()
  if (!trimmed) return null

  // Reject anything that isn't whitespace + the term grammar (guards against
  // partial regex matches inside an otherwise-invalid string).
  const STRICT_RE = /^\s*[+-]?\s*(?:\d*d(?:\d+|%)|\d+)(\s*[+-]\s*(?:\d*d(?:\d+|%)|\d+))*\s*$/i
  if (!STRICT_RE.test(trimmed)) return null

  const terms = []
  let flatModifier = 0
  let matched = false
  let match
  TERM_RE.lastIndex = 0
  while ((match = TERM_RE.exec(trimmed)) !== null) {
    matched = true
    const sign = match[1] === '-' ? -1 : 1
    if (match[4] !== undefined) {
      flatModifier += sign * parseInt(match[4], 10)
      continue
    }
    const count = match[2] ? parseInt(match[2], 10) : 1
    const sides = match[3] === '%' ? 100 : parseInt(match[3], 10)
    if (!SUPPORTED_SIDES.includes(sides)) return null
    if (count < 1 || count > 100) return null
    terms.push({ count, sides, sign })
  }

  if (!matched || terms.length === 0) return null

  return { formula: trimmed, terms, flatModifier }
}

/** Human-friendly canonical formula string, e.g. for display in a toast. */
export function formatDiceFormula(parsed) {
  const parts = parsed.terms.map((t, i) => {
    const prefix = i === 0 ? (t.sign < 0 ? '-' : '') : (t.sign < 0 ? ' - ' : ' + ')
    return `${prefix}${t.count}d${t.sides}`
  })
  if (parsed.flatModifier !== 0) {
    parts.push(parsed.flatModifier > 0 ? ` + ${parsed.flatModifier}` : ` - ${Math.abs(parsed.flatModifier)}`)
  }
  return parts.join('')
}

export { SUPPORTED_SIDES }
