// The GPU resources a dice world draws with, built once and shared: every die
// of a kind uses the same geometry, and every die of a kind and colour the same
// face materials (one canvas texture per face). Building them per die made a
// 50d20 roll upload 1000 textures (~340 MB with mipmaps), enough to lose the
// WebGL context on a phone. A die mesh only borrows them, so clearing the dice
// between rolls leaves them in place; they are freed with the world.

/** A cache of shared three.js resources: `get(key, create)` builds a value
 * the first time its key is asked for, `dispose()` frees them all. */
export function createAssetCache() {
  const entries = new Map()

  function get(key, create) {
    if (!entries.has(key)) entries.set(key, create())
    return entries.get(key)
  }

  function dispose() {
    entries.forEach(disposeAsset)
    entries.clear()
  }

  return {
    get,
    dispose,
    get size() { return entries.size }
  }
}

// What the cache holds: arrays of face materials (each with its texture) and
// buildDie results ({ geometry, faceTable, materialLabels }).
function disposeAsset(value) {
  if (Array.isArray(value)) {
    value.forEach(disposeAsset)
  } else if (value?.isMaterial) {
    value.map?.dispose()
    value.dispose()
  } else if (value?.geometry) {
    value.geometry.dispose()
  }
}

/** The cache key part for a dice colour theme (diceTheme.js). */
export function themeKey(theme) {
  return theme ? `${theme.bg}|${theme.fg}|${theme.accent}` : 'default'
}
