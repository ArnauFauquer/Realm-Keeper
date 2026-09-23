// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { sanitizeHtml } from '@/utils/sanitizeHtml'

describe('sanitizeHtml', () => {
  it('strips scripts, handlers and javascript: URLs', () => {
    const out = sanitizeHtml('<img src=x onerror="alert(1)"><script>alert(2)</script><a href="javascript:alert(3)">x</a>')
    expect(out).not.toMatch(/onerror|<script|javascript:/)
  })

  it('keeps the hooks NoteView wires up afterwards', () => {
    const html = '<a href="/note/a" data-note-link="a">a</a><code class="dice-roll" data-dice-formula="1d20" role="button" tabindex="0">1d20</code><pre class="mermaid">graph TD; A--&gt;B</pre><h2 id="intro">Intro</h2>'
    expect(sanitizeHtml(html)).toBe(html)
  })

  it('allows embedded iframes but not script-bearing ones', () => {
    expect(sanitizeHtml('<iframe src="https://www.youtube.com/embed/x" allowfullscreen=""></iframe>')).toContain('<iframe')
    expect(sanitizeHtml('<iframe src="javascript:alert(1)"></iframe>')).not.toContain('javascript:')
    expect(sanitizeHtml('<iframe srcdoc="<script>alert(1)</script>"></iframe>')).not.toContain('srcdoc')
  })

  it('adds rel=noopener to links opening a new tab', () => {
    expect(sanitizeHtml('<a href="https://x.test" target="_blank">x</a>')).toContain('rel="noopener noreferrer"')
  })
})
