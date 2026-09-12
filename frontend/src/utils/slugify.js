/**
 * Strips inline markdown syntax that can appear inside heading text down to
 * its visible label — markdown links `[text](url)`, images `![alt](url)`,
 * and (defensively) raw `[[wikilink|display]]` / `[[wikilink]]` syntax that
 * hasn't been converted to a markdown link yet — so headings that wrap a
 * link (e.g. `# Asesinato en la [[Mansión de los Blodstone]]`) display and
 * slugify using only the visible words, not the link target.
 */
export function stripInlineLinkSyntax(text) {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
}

/**
 * Turns heading text into a URL-safe id, matching markdown-it's default slug
 * shape, and disambiguates repeats by suffixing -1, -2, ... like markdown-it does.
 */
export function slugifyHeading(text, headerCount) {
  const cleanContent = stripInlineLinkSyntax(text.replace(/<[^>]+>/g, ''))
  const idBase = cleanContent
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'header'

  headerCount[idBase] = (headerCount[idBase] || 0) + 1
  return headerCount[idBase] > 1 ? `${idBase}-${headerCount[idBase] - 1}` : idBase
}
