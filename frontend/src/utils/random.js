// The app's source of randomness: the Web Crypto generator, not Math.random(),
// which is predictable. Dice, shuffles and ids all draw from it. Values come
// from a pool filled in batches, so drawing thousands (a starfield) costs one
// crypto call per 256.
const POOL_SIZE = 256
const pool = new Uint32Array(POOL_SIZE)
let next = POOL_SIZE

/** A number in [0, 1), like Math.random(). */
export function random() {
  if (next >= POOL_SIZE) {
    globalThis.crypto.getRandomValues(pool)
    next = 0
  }
  return pool[next++] / 0x100000000
}
