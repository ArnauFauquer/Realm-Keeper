// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { trimEdges } from '@/utils/trimEdges'
import { slugifyHeading, stripInlineLinkSyntax } from '@/utils/slugify'
import { htmlToText } from '@/utils/renderNote'
import { parseDocRef } from '@/utils/inlineRefs'

describe('trimEdges', () => {
  it('removes the character from both ends only', () => {
    expect(trimEdges('//a/b//', '/')).toBe('a/b')
    expect(trimEdges('---', '-')).toBe('')
    expect(trimEdges('abc', '/')).toBe('abc')
    expect(trimEdges('', '/')).toBe('')
  })

  it('is used for document refs', () => {
    expect(parseDocRef('chart:/regions/tavern/')).toEqual({ type: 'chart', id: 'regions/tavern' })
  })
})

describe('text cleaning stays fast on hostile input', () => {
  const long = 50000
  const timed = (fn) => {
    const start = performance.now()
    fn()
    return performance.now() - start
  }

  it.each([
    ['unclosed link brackets', '['.repeat(long)],
    ['unclosed images', '!['.repeat(long)],
    ['unclosed wikilinks', '[['.repeat(long)],
    ['unclosed tags', '<'.repeat(long)],
    ['a run of dashes', '-'.repeat(long) + 'x']
  ])('%s', (_, text) => {
    expect(timed(() => { stripInlineLinkSyntax(text); slugifyHeading(text, {}); htmlToText(text) })).toBeLessThan(500)
  })

  it('still strips what it should', () => {
    expect(stripInlineLinkSyntax('a [b](u) ![c](v) [[d|e]] [[f]]')).toBe('a b c e f')
    expect(htmlToText('<p>a &amp; <b>b</b></p>')).toBe('a & b')
  })
})
