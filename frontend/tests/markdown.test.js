import { describe, expect, it } from 'vitest'
import { createMarkdown } from '@/utils/markdown'

describe('createMarkdown', () => {
  it('turns inline dice, songs and chart references into placeholders', () => {
    const html = createMarkdown().renderInline('`2d6+1` `Action/theme.mp3` `chart:maps/town`')
    expect(html).toContain('data-dice-formula="2d6+1"')
    expect(html).toContain('data-song-key="Action/theme.mp3"')
    expect(html).toContain('data-doc-embed="chart"')
  })

  it('turns an sfx: track into a sound-effect button named after the file', () => {
    const html = createMarkdown().renderInline('`sfx:Efectos/door <creak>.mp3`')
    expect(html).toContain('data-sfx-key="Efectos/door &lt;creak&gt;.mp3"')
    expect(html).toContain('</span>door &lt;creak&gt;</code>')
    expect(html).not.toContain('data-song-key')
  })

  it('can be limited to some of them', () => {
    const html = createMarkdown({ refKinds: ['dice'] }).renderInline('`2d6+1` `Action/theme.mp3` `chart:maps/town`')
    expect(html).toContain('data-dice-formula="2d6+1"')
    expect(html).not.toContain('data-song-key')
    expect(html).not.toContain('data-doc-embed')
    expect(html).toContain('<code>chart:maps/town</code>')
  })

  it('leaves ordinary code alone', () => {
    expect(createMarkdown().renderInline('`foo()`')).toBe('<code>foo()</code>')
  })

  it('highlights ==text==, nested with other emphasis', () => {
    const md = createMarkdown()
    expect(md.renderInline('un ==AVENTURERO== valiente')).toBe('un <mark>AVENTURERO</mark> valiente')
    expect(md.renderInline('==**muy** importante==')).toBe('<mark><strong>muy</strong> importante</mark>')
    expect(md.renderInline('**==ojo==**')).toBe('<strong><mark>ojo</mark></strong>')
  })

  it('leaves a lone or unbalanced = as text', () => {
    const md = createMarkdown()
    expect(md.renderInline('a == b')).toBe('a == b')
    expect(md.renderInline('x = 1, ==sin cerrar')).toBe('x = 1, ==sin cerrar')
    expect(md.renderInline('`==code==`')).toBe('<code>==code==</code>')
    expect(md.render('Título\n===')).toBe('<h1>Título</h1>\n')
  })
})
