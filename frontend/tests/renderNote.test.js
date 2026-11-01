// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { hasMermaid, htmlToText, renderNote } from '@/utils/renderNote'

const ids = (html) => [...html.matchAll(/<h[1-6] id="([^"]+)"/g)].map((m) => m[1])

describe('renderNote', () => {
  it('gives every heading an id and lists it, in page order', () => {
    const { html, headings } = renderNote('# Intro\n\n## Fight & Loot\n\nText\n\n### Fight & Loot\n')
    expect(headings).toEqual([
      { level: 1, text: 'Intro', id: 'intro' },
      { level: 2, text: 'Fight & Loot', id: 'fight-loot' },
      { level: 3, text: 'Fight & Loot', id: 'fight-loot-1' }
    ])
    expect(ids(html)).toEqual(['intro', 'fight-loot', 'fight-loot-1'])
  })

  it('finds setext headings, headings in callouts and raw <h2>s, and skips fenced ones', () => {
    const md = [
      'Setext',
      '======',
      '',
      '> [!note] A callout',
      '> ## Inside',
      '',
      '~~~',
      '## not a heading',
      '~~~',
      '',
      '```',
      '# nor this',
      '```',
      '',
      '<h2>Raw</h2>'
    ].join('\n')
    const { html, headings } = renderNote(md)
    expect(headings.map((h) => h.id)).toEqual(['setext', 'inside', 'raw'])
    expect(ids(html)).toEqual(['setext', 'inside', 'raw'])
  })

  it('shows a heading by its visible words, not its link targets', () => {
    const { headings } = renderNote('## Into the [Blodstone Manor](/note/Places/Blodstone%20Manor)')
    expect(headings[0]).toMatchObject({ text: 'Into the Blodstone Manor', id: 'into-the-blodstone-manor' })
  })

  it('keeps ids that would match a property of document', () => {
    const { html } = renderNote('## Title\n\n## Images')
    expect(ids(html)).toEqual(['title', 'images'])
  })

  it('marks note links and wraps tables so they scroll', () => {
    const { html } = renderNote('[Hero](/note/People/The%20Hero)\n\n| a | b |\n|---|---|\n| 1 | 2 |')
    expect(html).toContain('<a href="/note/People/The%20Hero" data-note-link="People/The%20Hero"')
    expect(html).toMatch(/<div class="table-scroll"><table>[\s\S]*<\/table><\/div>/)
  })

  it('leaves mermaid blocks for mermaid and says so', () => {
    const { html } = renderNote('```mermaid\ngraph TD; A-->B\n```')
    expect(html).toContain('<pre class="mermaid">graph TD; A--&gt;B\n</pre>')
    expect(hasMermaid(html)).toBe(true)
    expect(hasMermaid(renderNote('plain').html)).toBe(false)
  })

  it('renders callouts and roll tables', () => {
    const { html } = renderNote('> [!tip] Hint\n> body\n\n| d4 | Loot |\n|---|---|\n| 1-2 | Gold |\n| 3-4 | Gem |')
    expect(html).toContain('class="callout callout-teal"')
    expect(html).toContain('data-roll-table="d4"')
  })

  it('drops scripts', () => {
    expect(renderNote('<script>alert(1)</script><img src=x onerror="alert(1)">').html).not.toMatch(/script|onerror/)
  })
})

describe('htmlToText', () => {
  it('strips tags and decodes entities', () => {
    expect(htmlToText('<code>2d6</code> &amp; <em>loot</em> &#x41;&#66; &lt;x&gt;')).toBe('2d6 & loot AB <x>')
  })
})
