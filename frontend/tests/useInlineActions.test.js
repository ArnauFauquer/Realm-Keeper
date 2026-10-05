// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/composables/useDiceRoller', () => ({ useDiceRoller: () => ({}) }))
vi.mock('@/composables/usePlayer', () => ({ usePlayer: () => ({}) }))
vi.mock('@/composables/useSoundEffects', () => ({ useSoundEffects: () => ({}) }))
vi.mock('@/api/http', () => ({ post: vi.fn() }))

const { findInlineAction, syncSfxButtons } = await import('@/composables/useInlineActions')
const { findEmbedHosts } = await import('@/composables/useDocEmbeds')

const html = (markup) => {
  const root = document.createElement('article')
  root.innerHTML = markup
  document.body.appendChild(root)
  return root
}

describe('findInlineAction', () => {
  const root = html(`
    <p><code class="dice-roll" data-dice-formula="2d6"><span class="mdi"></span>2d6</code></p>
    <p><code class="song-link" data-song-key="Action/a.mp3">a</code><code data-sfx-key="Fx/door.mp3">door</code></p>
    <table><tr><th><span class="roll-table-die" data-roll-table="d4">d4</span></th></tr></table>
    <a href="/note/Places/La%20Ci%C3%A9naga" data-note-link="x"><em>Ciénaga</em></a>
    <a href="https://example.com">out</a>
    <span class="img-screen-wrapper"><img src="/a.png"><button class="img-screen-btn"><span>Screen</span></button></span>
    <span class="doc-embed"><div class="sheet"><code data-dice-formula="1d20">1d20</code><a href="/note/Other">x</a></div></span>
  `)

  it('finds the action from anything inside it', () => {
    expect(findInlineAction(root.querySelector('.dice-roll .mdi'), root)).toMatchObject({ kind: 'dice', value: '2d6' })
    expect(findInlineAction(root.querySelector('[data-song-key]'), root)).toMatchObject({ kind: 'song', value: 'Action/a.mp3' })
    expect(findInlineAction(root.querySelector('[data-sfx-key]'), root)).toMatchObject({ kind: 'sfx', value: 'Fx/door.mp3' })
    expect(findInlineAction(root.querySelector('.roll-table-die'), root)).toMatchObject({ kind: 'roll-table', value: 'd4' })
    expect(findInlineAction(root.querySelector('.img-screen-btn span'), root)).toMatchObject({ kind: 'screen' })
    expect(findInlineAction(root.querySelector('a em'), root)).toMatchObject({
      kind: 'note-link',
      value: '/note/Places/La%20Ci%C3%A9naga'
    })
  })

  it('ignores plain content and other links', () => {
    expect(findInlineAction(root.querySelector('p'), root)).toBeNull()
    expect(findInlineAction(root.querySelector('a[href^="https"]'), root)).toBeNull()
    expect(findInlineAction(null, root)).toBeNull()
  })

  it('leaves everything inside an embedded document to that component', () => {
    expect(findInlineAction(root.querySelector('.doc-embed code'), root)).toBeNull()
    expect(findInlineAction(root.querySelector('.doc-embed a'), root)).toBeNull()
  })

  it('ignores elements outside the root', () => {
    const elsewhere = html('<code data-dice-formula="1d4">1d4</code>')
    expect(findInlineAction(elsewhere.firstChild, root)).toBeNull()
  })
})

describe('syncSfxButtons', () => {
  it('marks the playing effects and their progress', () => {
    const root = html('<code data-sfx-key="a"><span class="mdi mdi-waveform"></span></code><code data-sfx-key="b"><span class="mdi mdi-waveform"></span></code>')
    syncSfxButtons(root, { a: { progress: 0.5 } })
    const [a, b] = root.querySelectorAll('code')
    expect(a.classList.contains('is-playing')).toBe(true)
    expect(a.getAttribute('aria-pressed')).toBe('true')
    expect(a.style.getPropertyValue('--sfx-progress')).toBe('0.5')
    expect(a.querySelector('.mdi').classList.contains('mdi-stop')).toBe(true)
    expect(b.classList.contains('is-playing')).toBe(false)
  })
})

describe('findEmbedHosts', () => {
  it('skips placeholders inside another embed', () => {
    const root = html(`
      <span class="doc-embed" data-doc-embed="chart" data-doc-id="map"></span>
      <span class="doc-embed" data-doc-embed="character" data-doc-id="hero">
        <span class="doc-embed" data-doc-embed="character" data-doc-id="hero"></span>
      </span>
    `)
    expect(findEmbedHosts(root).map((el) => el.getAttribute('data-doc-id'))).toEqual(['map', 'hero'])
  })
})
