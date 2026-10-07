// The colours things on a map can be given. A chart's pins and paths, and a
// battlemap's tokens, share the same middle six; each starts and ends with
// its own (a chart's first is the violet its pins and paths had before they
// had a colour; a token's first is the token default, its last a neutral grey).
const SHARED = ['#22d3ee', '#f472b6', '#34d399', '#fbbf24', '#60a5fa', '#fb7185']

/** A chart's pins and paths, cycled through in order as they are placed. */
export const CHART_COLORS = ['#a78bfa', ...SHARED, '#c084fc']

/** A battlemap token's colour (behind its initials, or around its image). */
export const TOKEN_COLORS = ['#6d4fc2', ...SHARED, '#94a3b8']

/** A battlemap area's colour (its fill, faint, and its outline). */
export const AREA_COLORS = ['#f97316', ...SHARED, '#94a3b8']
