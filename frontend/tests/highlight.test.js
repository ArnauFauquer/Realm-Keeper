import { describe, expect, it } from 'vitest'
import MarkdownIt from 'markdown-it'
import { highlightPlugin } from '@/utils/highlight'

const md = new MarkdownIt().use(highlightPlugin)
const html = (s) => md.renderInline(s)

describe('==highlight==', () => {
  it('wraps the text in <mark>', () => {
    expect(html('a ==b== c')).toBe('a <mark>b</mark> c')
  })

  it('nests with bold and italics', () => {
    expect(html('==**b**==')).toBe('<mark><strong>b</strong></mark>')
    expect(html('**==b==**')).toBe('<strong><mark>b</mark></strong>')
    expect(html('==a _b_ c==')).toBe('<mark>a <em>b</em> c</mark>')
  })

  it('leaves a lone = and a spaced == as text', () => {
    expect(html('a = b')).toBe('a = b')
    expect(html('a == b')).toBe('a == b')
    expect(html('==')).toBe('==')
    expect(html('==a')).toBe('==a')
  })

  it('puts an odd = after the closing marks, as text', () => {
    expect(html('===a===')).toBe('=<mark>a</mark>=')
  })

  it('highlights several in a line', () => {
    expect(html('==a== and ==b==')).toBe('<mark>a</mark> and <mark>b</mark>')
  })

  it('does not highlight inside code', () => {
    expect(html('`==a==`')).toBe('<code>==a==</code>')
  })
})
