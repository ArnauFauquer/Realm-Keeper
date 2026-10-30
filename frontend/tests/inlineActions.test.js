// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  roll: vi.fn(), showRoll: vi.fn(), playByKey: vi.fn(), toggle: vi.fn()
}))
vi.mock('@/composables/useDiceRoller', () => ({ useDiceRoller: () => ({ roll: m.roll, showRoll: m.showRoll }) }))
vi.mock('@/composables/usePlayer', () => ({ usePlayer: () => ({ playByKey: m.playByKey }) }))
vi.mock('@/composables/useSoundEffects', () => ({ useSoundEffects: () => ({ toggle: m.toggle }) }))

const { findInlineAction, runInlineAction, syncSfxButtons } = await import('@/composables/useInlineActions')

let root
const html = (s) => { root = document.createElement('div'); root.innerHTML = s; document.body.append(root); return root }

const originalMatchMedia = window.matchMedia
const originalScrollIntoView = Element.prototype.scrollIntoView
afterEach(() => {
  window.matchMedia = originalMatchMedia
  Element.prototype.scrollIntoView = originalScrollIntoView
})

beforeEach(() => {
  document.body.innerHTML = ''
  Object.values(m).forEach((fn) => fn.mockReset())
  window.matchMedia = vi.fn(() => ({ matches: true }))
  Element.prototype.scrollIntoView = vi.fn()
})

describe('findInlineAction', () => {
  it('finds each kind of clickable, from a child of it', () => {
    html(`<span data-dice-formula="1d20"><b id="d">x</b></span>
      <span data-song-key="a/b.mp3"></span><span data-sfx-key="s"></span>
      <span data-roll-table="d6"></span><button class="img-screen-btn"></button>
      <a href="/note/x">x</a><a href="https://e.test">out</a>`)
    const at = (sel) => findInlineAction(root.querySelector(sel), root)
    expect(at('#d')).toMatchObject({ kind: 'dice', value: '1d20' })
    expect(at('[data-song-key]')).toMatchObject({ kind: 'song', value: 'a/b.mp3' })
    expect(at('[data-sfx-key]')).toMatchObject({ kind: 'sfx', value: 's' })
    expect(at('[data-roll-table]')).toMatchObject({ kind: 'roll-table', value: 'd6' })
    expect(at('.img-screen-btn').kind).toBe('screen')
    expect(at('a[href^="/note/"]')).toMatchObject({ kind: 'note-link', value: '/note/x' })
    expect(at('a[href^="https"]')).toBeNull()
  })

  it('leaves embedded documents to their own component', () => {
    html('<div class="doc-embed"><span data-dice-formula="1d6"></span></div>')
    expect(findInlineAction(root.querySelector('span'), root)).toBeNull()
  })

  it('ignores targets outside the root and non-elements', () => {
    html('<p></p>')
    const outside = document.createElement('span')
    outside.setAttribute('data-dice-formula', '1d6')
    document.body.append(outside)
    expect(findInlineAction(outside, root)).toBeNull()
    expect(findInlineAction(null, root)).toBeNull()
    expect(findInlineAction({}, root)).toBeNull()
  })
})

describe('runInlineAction', () => {
  it('rolls dice', () => {
    runInlineAction({ kind: 'dice', value: '1d20' })
    expect(m.roll).toHaveBeenCalledWith('1d20')
  })

  it('plays a song, marking the button while it loads', async () => {
    html('<span data-song-key="k"></span>')
    const el = root.firstChild
    let done
    m.playByKey.mockReturnValue(new Promise((r) => { done = r }))
    const run = runInlineAction({ kind: 'song', el, value: 'k' })
    expect(el.classList.contains('loading')).toBe(true)
    await runInlineAction({ kind: 'song', el, value: 'k' })
    expect(m.playByKey).toHaveBeenCalledTimes(1)
    done()
    await run
    expect(el.classList.contains('loading')).toBe(false)
  })

  it('flags a song that fails, then clears the flag', async () => {
    vi.useFakeTimers()
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    html('<span data-song-key="k"></span>')
    const el = root.firstChild
    m.playByKey.mockRejectedValue(new Error('x'))
    await runInlineAction({ kind: 'song', el, value: 'k' })
    expect(el.classList.contains('song-link-error')).toBe(true)
    vi.advanceTimersByTime(2000)
    expect(el.classList.contains('song-link-error')).toBe(false)
    log.mockRestore(); vi.useRealTimers()
  })

  it('toggles a sound effect and flags one that fails', async () => {
    vi.useFakeTimers()
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    html('<span data-sfx-key="s"></span>')
    const el = root.firstChild
    await runInlineAction({ kind: 'sfx', el, value: 's' })
    expect(m.toggle).toHaveBeenCalledWith('s')
    m.toggle.mockRejectedValue(new Error('x'))
    await runInlineAction({ kind: 'sfx', el, value: 's' })
    expect(el.classList.contains('sfx-button-error')).toBe(true)
    vi.advanceTimersByTime(2000)
    expect(el.classList.contains('sfx-button-error')).toBe(false)
    log.mockRestore(); vi.useRealTimers()
  })

  it('does nothing for the kinds the markdown body handles itself', () => {
    expect(runInlineAction({ kind: 'screen' })).toBeUndefined()
    expect(runInlineAction({ kind: 'note-link' })).toBeUndefined()
  })
})

describe('syncSfxButtons', () => {
  it('shows which effects sound, and how far along', () => {
    html(`<button data-sfx-key="a"><i class="mdi mdi-waveform"></i></button>
      <button data-sfx-key="b"><i class="mdi mdi-stop"></i></button>
      <div class="doc-embed"><button data-sfx-key="a"></button></div>`)
    syncSfxButtons(root, { a: { progress: 0.5 } })
    const [a, b, embedded] = root.querySelectorAll('[data-sfx-key]')
    expect(a.classList.contains('is-playing')).toBe(true)
    expect(a.getAttribute('aria-pressed')).toBe('true')
    expect(a.style.getPropertyValue('--sfx-progress')).toBe('0.5')
    expect(a.querySelector('.mdi').classList.contains('mdi-stop')).toBe(true)
    expect(b.getAttribute('aria-pressed')).toBe('false')
    expect(b.querySelector('.mdi').classList.contains('mdi-waveform')).toBe(true)
    expect(embedded.hasAttribute('aria-pressed')).toBe(false)
  })
})

describe('a roll table', () => {
  const table = (extra = '') => html(`<table ${extra}><thead><tr><th data-roll-table="d6"><span data-roll-table="d6" id="die">d6</span></th></tr></thead>
    <tbody><tr data-roll-min="1" data-roll-max="3"><td>1-3</td><td>Rats</td></tr><tr data-roll-min="4" data-roll-max="6"><td>4-6</td><td>Wolves</td></tr></tbody></table>`)

  it('throws the die and marks the row it landed on, with the number', async () => {
    table()
    m.roll.mockResolvedValue({ total: 5 })
    const die = root.querySelector('#die')
    await runInlineAction({ kind: 'roll-table', el: die, value: 'd6' })
    expect(m.roll).toHaveBeenCalledWith('d6', { outcome: expect.any(Function) })
    const rows = root.querySelectorAll('tbody tr')
    expect(rows[1].classList.contains('roll-hit')).toBe(true)
    expect(die.querySelector('.roll-table-last').textContent).toBe('5')
    expect(root.querySelector('table').hasAttribute('data-rolling')).toBe(false)
    // The next roll moves the mark, reusing the badge.
    m.roll.mockResolvedValue({ total: 1 })
    await runInlineAction({ kind: 'roll-table', el: die, value: 'd6' })
    expect(rows[0].classList.contains('roll-hit')).toBe(true)
    expect(rows[1].classList.contains('roll-hit')).toBe(false)
    expect(die.querySelectorAll('.roll-table-last')).toHaveLength(1)
  })

  it('names the row for the toast', async () => {
    table()
    m.roll.mockImplementation(async (_f, { outcome }) => {
      expect(outcome({ total: 2 })).toBe('Rats')
      expect(outcome({ total: 50 })).toBe('No row for 50')
      return { total: 2 }
    })
    await runInlineAction({ kind: 'roll-table', el: root.querySelector('#die'), value: 'd6' })
    expect.assertions(2)
  })

  it('draws the number for a die with no body, shown as 1dN', async () => {
    table('data-roll-virtual')
    await runInlineAction({ kind: 'roll-table', el: root.querySelector('#die'), value: 'd6' })
    expect(m.roll).not.toHaveBeenCalled()
    expect(m.showRoll).toHaveBeenCalledWith('1d6', expect.objectContaining({ total: expect.any(Number) }), { outcome: expect.stringMatching(/Rats|Wolves/) })
  })

  it('scans down the rows first when motion is allowed', async () => {
    vi.useFakeTimers()
    window.matchMedia = vi.fn(() => ({ matches: false }))
    table('data-roll-virtual')
    const run = runInlineAction({ kind: 'roll-table', el: root.querySelector('#die'), value: 'd6' })
    await vi.advanceTimersByTimeAsync(2000)
    await run
    expect(m.showRoll).toHaveBeenCalled()
    expect(root.querySelectorAll('.roll-scan')).toHaveLength(0)
    vi.useRealTimers()
  })

  it('ignores a click while the table is rolling, or a die outside a table', async () => {
    table('data-rolling')
    await runInlineAction({ kind: 'roll-table', el: root.querySelector('#die'), value: 'd6' })
    expect(m.roll).not.toHaveBeenCalled()
    await runInlineAction({ kind: 'roll-table', el: document.createElement('span'), value: 'd6' })
    expect(m.roll).not.toHaveBeenCalled()
  })

  it('shows the number even when no row matches, and when the roll did not happen', async () => {
    table()
    m.roll.mockResolvedValue({ total: 99 })
    const die = root.querySelector('#die')
    await runInlineAction({ kind: 'roll-table', el: die, value: 'd6' })
    expect(die.querySelector('.roll-table-last').textContent).toBe('99')
    expect(root.querySelector('.roll-hit')).toBeNull()
    m.roll.mockResolvedValue(null)
    await runInlineAction({ kind: 'roll-table', el: die, value: 'd6' })
    expect(root.querySelector('table').hasAttribute('data-rolling')).toBe(false)
  })
})
