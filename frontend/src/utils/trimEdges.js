/** `text` without the `char` repeated at its start and end. A loop rather than
 * a /^x+|x+$/ regex, which backtracks quadratically on a long run of `char`. */
export function trimEdges(text, char) {
  let start = 0
  let end = text.length
  while (start < end && text[start] === char) start++
  while (end > start && text[end - 1] === char) end--
  return text.slice(start, end)
}
