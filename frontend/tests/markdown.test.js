import { describe, expect, it } from 'vitest'
import { createMarkdown } from '@/utils/markdown'

describe('createMarkdown', () => {
  it('turns inline dice, songs and chart references into placeholders', () => {
    const html = createMarkdown().renderInline('`2d6+1` `Action/theme.mp3` `chart:maps/town`')
    expect(html).toContain('data-dice-formula="2d6+1"')
    expect(html).toContain('data-song-key="Action/theme.mp3"')
    expect(html).toContain('data-doc-embed="chart"')
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
})
