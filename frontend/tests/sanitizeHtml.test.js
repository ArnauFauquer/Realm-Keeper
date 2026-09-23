// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { lockAssetImages, sanitizeHtml } from '@/utils/sanitizeHtml'

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

  it('drops page-wide styles, forms and iframe permission delegation', () => {
    const out = sanitizeHtml('<style>body{display:none}</style><form action="https://evil.test"><input name="password"><button>Sign in</button></form><iframe src="https://evil.test" allow="camera; clipboard-read"></iframe><span style="color:red">red</span>')
    expect(out).not.toMatch(/<style|<form|<input|<button|allow=/)
    expect(out).toContain('sandbox="allow-scripts allow-same-origin allow-popups allow-presentation"')
    expect(out).toContain('<span style="color:red">red</span>')
  })

  it('adds rel=noopener to links opening a new tab', () => {
    expect(sanitizeHtml('<a href="https://x.test" target="_blank">x</a>')).toContain('rel="noopener noreferrer"')
  })
})

describe('lockAssetImages', () => {
  it('replaces asset library images, relative or absolute, with a placeholder', () => {
    const html = '<p><img src="/api/asset-library/assets/asset-library/map.png"><img src="https://app.test/api/asset-library/assets/asset-library/a%20b.png"></p>'
    const out = lockAssetImages(html)
    expect(out).not.toContain('<img')
    expect(out.match(/locked-asset/g)).toHaveLength(2)
  })

  it('leaves other images alone', () => {
    const html = '<img src="https://example.test/cat.png">'
    expect(lockAssetImages(html)).toBe(html)
  })
})
