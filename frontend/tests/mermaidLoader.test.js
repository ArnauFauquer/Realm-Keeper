// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mermaid = vi.hoisted(() => ({ initialize: vi.fn(), run: vi.fn() }))
vi.mock('mermaid', () => ({ default: mermaid }))

let renderMermaidIn
beforeEach(async () => {
  vi.resetModules()
  mermaid.initialize.mockReset()
  mermaid.run.mockReset().mockResolvedValue()
  vi.stubGlobal('requestAnimationFrame', (fn) => { fn(); return 0 })
  ;({ renderMermaidIn } = await import('@/composables/useMermaid'))
})

afterEach(() => { vi.unstubAllGlobals() })

const rootWith = (html) => {
  const root = document.createElement('div')
  root.innerHTML = html
  return root
}

describe('renderMermaidIn', () => {
  it('never loads Mermaid for a note without a diagram', async () => {
    await renderMermaidIn(rootWith('<p>hi</p>'))
    expect(mermaid.initialize).not.toHaveBeenCalled()
    expect(mermaid.run).not.toHaveBeenCalled()
  })

  it('draws the diagrams, initialising Mermaid only once', async () => {
    const root = rootWith('<pre class="mermaid">graph TD; A-->B</pre><pre class="mermaid">graph TD; C-->D</pre>')
    await renderMermaidIn(root)
    await renderMermaidIn(root)
    expect(mermaid.initialize).toHaveBeenCalledTimes(1)
    expect(mermaid.initialize.mock.calls[0][0]).toMatchObject({ startOnLoad: false, theme: 'dark' })
    expect(mermaid.run).toHaveBeenCalledTimes(2)
    expect(mermaid.run.mock.calls[0][0].nodes).toHaveLength(2)
  })

  it('stops when the HTML was replaced while waiting', async () => {
    const root = rootWith('<pre class="mermaid">x</pre>')
    await renderMermaidIn(root, () => false)
    expect(mermaid.run).not.toHaveBeenCalled()
  })

  it('stops when the view is left after the layout wait', async () => {
    const root = rootWith('<pre class="mermaid">x</pre>')
    const current = vi.fn().mockReturnValueOnce(true).mockReturnValue(false)
    await renderMermaidIn(root, current)
    expect(mermaid.run).not.toHaveBeenCalled()
  })

  it('logs a diagram that cannot be drawn instead of throwing', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    mermaid.run.mockRejectedValue(new Error('parse'))
    await expect(renderMermaidIn(rootWith('<pre class="mermaid">x</pre>'))).resolves.toBeUndefined()
    expect(log).toHaveBeenCalled()
    log.mockRestore()
  })
})
