import { rollResult } from '@/utils/diceNotation'

// Rolling without 3D dice, for a device that can't draw them (no WebGL, or
// the 3D code failed to load): same result shape as diceRoller.js's
// rollParsedFormula, so the toast and the screen can't tell the difference.

function cryptoUint32() {
  const value = new Uint32Array(1)
  crypto.getRandomValues(value)
  return value[0]
}

/** A die's value, 1 to `sides`, from the platform's cryptographic generator.
 * Draws past the last whole multiple of `sides` are thrown away, so no face
 * is favoured by the modulo. */
export function randomDieValue(sides, randomUint32 = cryptoUint32) {
  const limit = Math.floor(0x100000000 / sides) * sides
  let n
  do {
    n = randomUint32()
  } while (n >= limit)
  return (n % sides) + 1
}

/** Rolls a parsed formula (utils/diceNotation.js) with no dice to watch:
 * { total, groups, flatModifier }. A percentile die is 1 to 100, as the
 * tens and units pair reads. */
export function rollWithoutDice(parsed, randomUint32 = cryptoUint32) {
  const rolls = parsed.terms.map(term => Array.from({ length: term.count }, () => randomDieValue(term.sides, randomUint32)))
  return rollResult(parsed.terms, rolls, parsed.flatModifier)
}
