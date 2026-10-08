// `==text==` highlights its text (a <mark>), as in Obsidian. Built on
// markdown-it's delimiter machinery, the same way ~~strikethrough~~ is, so it
// nests with **bold** and _italics_ and a lone `=` or `a == b` stays text.

const EQUALS = 0x3d

/** Inline rule: every run of `=` pushes `==` text tokens a later pass may pair. */
function tokenize(state, silent) {
  if (silent || state.src.charCodeAt(state.pos) !== EQUALS) return false

  const scanned = state.scanDelims(state.pos, true)
  let length = scanned.length
  if (length < 2) return false

  if (length % 2) {
    state.push('text', '', 0).content = '='
    length--
  }
  for (let i = 0; i < length; i += 2) {
    state.push('text', '', 0).content = '=='
    if (!scanned.can_open && !scanned.can_close) continue
    state.delimiters.push({
      marker: EQUALS,
      length: 0,
      token: state.tokens.length - 1,
      end: -1,
      open: scanned.can_open,
      close: scanned.can_close
    })
  }
  state.pos += scanned.length
  return true
}

/** Turns each pair balance_pairs matched into <mark> … </mark>. */
function pairUp(state, delimiters) {
  const loneMarkers = []
  for (const start of delimiters) {
    if (start.marker !== EQUALS || start.end === -1) continue
    const end = delimiters[start.end]

    Object.assign(state.tokens[start.token], { type: 'mark_open', tag: 'mark', nesting: 1, markup: '==', content: '' })
    Object.assign(state.tokens[end.token], { type: 'mark_close', tag: 'mark', nesting: -1, markup: '==', content: '' })

    const before = state.tokens[end.token - 1]
    if (before.type === 'text' && before.content === '=') loneMarkers.push(end.token - 1)
  }

  // `===a===` leaves an odd `=` just inside the closing marks: move it after
  // them, so it reads as text outside the highlight rather than inside it.
  while (loneMarkers.length) {
    const i = loneMarkers.pop()
    let j = i + 1
    while (j < state.tokens.length && state.tokens[j].type === 'mark_close') j++
    j--
    if (i !== j) [state.tokens[i], state.tokens[j]] = [state.tokens[j], state.tokens[i]]
  }
}

export function highlightPlugin(md) {
  md.inline.ruler.before('emphasis', 'mark', tokenize)
  md.inline.ruler2.before('emphasis', 'mark', (state) => {
    pairUp(state, state.delimiters)
    for (const meta of state.tokens_meta || []) {
      if (meta?.delimiters) pairUp(state, meta.delimiters)
    }
  })
}
