/**
 * Turns heading text into a URL-safe id, matching markdown-it's default slug
 * shape, and disambiguates repeats by suffixing -1, -2, ... like markdown-it does.
 */
export function slugifyHeading(text, headerCount) {
  const cleanContent = text.replace(/<[^>]+>/g, '')
  const idBase = cleanContent
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'header'

  headerCount[idBase] = (headerCount[idBase] || 0) + 1
  return headerCount[idBase] > 1 ? `${idBase}-${headerCount[idBase] - 1}` : idBase
}
