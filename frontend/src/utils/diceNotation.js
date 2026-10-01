// Dice notation parser, e.g. "4d8+5", "2d20-1", "1d100", "d%", "d2", "hf+1d6",
// "4d6kh3", "adv+5".
// Shared by the note-rendering code-span hook and the manual formula field
// in DicePanel, so both validate against exactly the same grammar.
const SUPPORTED_SIDES = [2, 4, 6, 8, 10, 12, 20, 100]
// Every die is a live physics body, so a formula pasted into a note can't be
// allowed to throw hundreds of them at once.
export const MAX_DICE = 50

// `hf` is the Hope & Fear (duality) pair: two d12s told apart by colour,
// summed like any other dice, plus an outcome read from which one is higher.
const DUALITY_TOKEN = 'hf'
const DUALITY_SIDES = 12
const DUALITY_LABEL = 'Hope & Fear'

// Keep-highest / keep-lowest: `NdMkhK` / `NdMklK` roll N dice and only sum
// the K best / worst (K defaults to 1). `adv` and `dis` are D&D advantage and
// disadvantage, i.e. 2d20kh1 and 2d20kl1.
const KEEP_ALIASES = {
  adv: { count: 2, sides: 20, keep: { mode: 'high', count: 1 } },
  dis: { count: 2, sides: 20, keep: { mode: 'low', count: 1 } }
}
export const ADVANTAGE_TOKENS = { high: 'adv', low: 'dis' }

const TERM_SRC = String.raw`(?:hf|adv|dis|\d*d(?:\d+|%)(?:k[hl]\d*)?|\d+)`
const TERM_RE = /([+-]?)\s*(?:(hf)|(adv|dis)|(\d*)d(\d+|%)(?:k([hl])(\d*))?|(\d+))/gi
const STRICT_RE = new RegExp(String.raw`^\s*[+-]?\s*${TERM_SRC}(\s*[+-]\s*${TERM_SRC})*\s*$`, 'i')

/**
 * Parses a dice formula into { formula, terms, flatModifier } or returns
 * null if the string contains anything outside the supported grammar
 * (unsupported die size, stray characters, etc).
 *
 * terms: [{ count, sides, sign, kind?, keep? }] - one entry per NdM group,
 * sign is 1|-1. `hf` expands to two d12 terms with kind 'hope' and 'fear';
 * it can appear at most once and only added, never subtracted. `keep` is
 * { mode: 'high'|'low', count } for a keep-highest/lowest group.
 * flatModifier: sum of all bare-number terms (already sign-applied).
 */
export function parseDiceFormula(text) {
  if (typeof text !== 'string') return null
  const trimmed = text.trim()
  if (!trimmed) return null

  // Reject anything that isn't whitespace + the term grammar (guards against
  // partial regex matches inside an otherwise-invalid string).
  if (!STRICT_RE.test(trimmed)) return null

  const terms = []
  let flatModifier = 0
  let hasDuality = false
  let match
  TERM_RE.lastIndex = 0
  while ((match = TERM_RE.exec(trimmed)) !== null) {
    const sign = match[1] === '-' ? -1 : 1
    if (match[2] !== undefined) {
      if (hasDuality || sign < 0) return null
      hasDuality = true
      terms.push(
        { count: 1, sides: DUALITY_SIDES, sign: 1, kind: 'hope' },
        { count: 1, sides: DUALITY_SIDES, sign: 1, kind: 'fear' }
      )
      continue
    }
    if (match[3] !== undefined) {
      const alias = KEEP_ALIASES[match[3].toLowerCase()]
      terms.push({ ...alias, keep: { ...alias.keep }, sign })
      continue
    }
    if (match[8] !== undefined) {
      flatModifier += sign * parseInt(match[8], 10)
      continue
    }
    const count = match[4] ? parseInt(match[4], 10) : 1
    const sides = match[5] === '%' ? 100 : parseInt(match[5], 10)
    if (!SUPPORTED_SIDES.includes(sides)) return null
    if (count < 1 || count > 100) return null
    const term = { count, sides, sign }
    if (match[6] !== undefined) {
      const keepCount = match[7] ? parseInt(match[7], 10) : 1
      if (keepCount < 1 || keepCount >= count) return null
      term.keep = { mode: match[6].toLowerCase() === 'h' ? 'high' : 'low', count: keepCount }
    }
    terms.push(term)
  }

  if (terms.length === 0) return null
  if (countPhysicalDice(terms) > MAX_DICE) return null

  return { formula: trimmed, terms, flatModifier }
}

/** How many dice a roll throws: a percentile roll is two d10s. */
export function countPhysicalDice(terms) {
  return terms.reduce((n, t) => n + t.count * (t.sides === 100 ? 2 : 1), 0)
}

function formatTermBody(t) {
  if (!t.keep) return `${t.count}d${t.sides}`
  if (t.sides === 20 && t.count === 2 && t.keep.count === 1) {
    return t.keep.mode === 'high' ? 'd20 Advantage' : 'd20 Disadvantage'
  }
  return `${t.count}d${t.sides}k${t.keep.mode === 'high' ? 'h' : 'l'}${t.keep.count}`
}

/**
 * Indices of the dice a keep-highest/lowest group throws away (ties drop
 * the later die). Empty when the group keeps everything.
 */
export function droppedIndices(rolls, keep) {
  if (!keep) return []
  const order = rolls.map((v, i) => i)
    .sort((a, b) => keep.mode === 'high' ? rolls[b] - rolls[a] || a - b : rolls[a] - rolls[b] || a - b)
  return order.slice(keep.count).sort((a, b) => a - b)
}

/** Human-friendly canonical formula string, e.g. for display in a toast. */
export function formatDiceFormula(parsed) {
  const parts = []
  parsed.terms.forEach(t => {
    // The fear half of the pair is printed together with its hope half.
    if (t.kind === 'fear') return
    const body = t.kind === 'hope' ? DUALITY_LABEL : formatTermBody(t)
    const prefix = parts.length === 0 ? (t.sign < 0 ? '-' : '') : (t.sign < 0 ? ' - ' : ' + ')
    parts.push(`${prefix}${body}`)
  })
  if (parsed.flatModifier !== 0) {
    parts.push(parsed.flatModifier > 0 ? ` + ${parsed.flatModifier}` : ` - ${Math.abs(parsed.flatModifier)}`)
  }
  return parts.join('')
}

/**
 * Reads the Hope & Fear outcome off a rolled result's groups (as returned by
 * dice/diceRoller.js): 'critical' on a tie, otherwise whichever die is
 * higher. Returns null when the roll had no duality pair.
 */
export function resolveDuality(groups) {
  const hope = groups?.find(g => g.kind === 'hope')?.rolls?.[0]
  const fear = groups?.find(g => g.kind === 'fear')?.rolls?.[0]
  if (hope == null || fear == null) return null
  const outcome = hope === fear ? 'critical' : hope > fear ? 'hope' : 'fear'
  return { hope, fear, outcome }
}

/**
 * Natural 20 / natural 1 on the roll's single added d20 (modifiers don't
 * matter): a 20 is a critical, a 1 a fumble. Returns null unless exactly one
 * d20 counts towards the total.
 */
export function resolveNatural(groups) {
  const d20s = (groups || []).filter(g => g.sides === 20 && g.sign > 0 && !g.kind)
  // With advantage/disadvantage only the die that was kept counts, and a
  // natural result only means something on a single d20 - summing several
  // (2d20, 1d20+1d20) is just a total.
  const rolls = d20s.flatMap(g => g.rolls.filter((v, i) => !g.dropped?.includes(i)))
  if (rolls.length !== 1) return null
  return { critical: rolls[0] === 20, fumble: rolls[0] === 1 }
}

/** CSS hook for the die at `index` in a roll breakdown: 'dropped' for a die
 * a keep-highest/lowest group threw away, 'crit' / 'fumble' for the natural
 * 20 / 1 of a roll whose `natural` (resolveNatural) is set, otherwise null. */
export function rollClass(group, index, natural) {
  if (group.dropped?.includes(index)) return 'dropped'
  if (!natural || group.sides !== 20 || group.sign < 0 || group.kind) return null
  const value = group.rolls[index]
  if (value === 20) return 'crit'
  if (value === 1) return 'fumble'
  return null
}

export const NATURAL_OUTCOME_LABELS = {
  critical: 'Critical!',
  fumble: 'Fumble!'
}

export const DUALITY_OUTCOME_LABELS = {
  critical: 'Critical!',
  hope: 'with Hope',
  fear: 'with Fear'
}

export { SUPPORTED_SIDES, DUALITY_TOKEN }
