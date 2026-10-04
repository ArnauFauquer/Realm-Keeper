// The counters a token shows, from whoever it stands for: an adversary's own
// (in the encounter), or a character's saved ones. The GM's view of the map
// works them out here; the screens are sent the same thing, worked out by the
// server (backend services/battlemap_projection.py).

/**
 * `token.bars` names the counters to show, `token.show_bars` whether to show
 * them at all. `encounter` is the encounter the map is attached to and
 * `characters` the characters' saved values; either may be null.
 */
export function metersFor(token, encounter, characters) {
  if (!token.show_bars || !token.combatant) return []
  const combatant = encounter?.combatants.find((c) => c.id === token.combatant)
  if (!combatant) return []
  const resources = combatant.type === 'character'
    ? characters?.characters.find((c) => c.id === combatant.sheet)?.resources
    : combatant.resources
  return (token.bars || [])
    .filter((name) => resources?.[name])
    .map((name) => {
      const { current, max, min = 0, color = null, style = null } = resources[name]
      return { name, current, max, min, color, style }
    })
}

/** The names of the counters a token could show. */
export function barOptions(token, encounter, characters) {
  const combatant = encounter?.combatants.find((c) => c.id === token.combatant)
  if (!combatant) return []
  const resources = combatant.type === 'character'
    ? characters?.characters.find((c) => c.id === combatant.sheet)?.resources
    : combatant.resources
  return Object.keys(resources || {})
}
