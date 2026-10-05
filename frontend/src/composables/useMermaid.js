// Mermaid is large (most of what the note view used to weigh) and most notes
// have no diagram: it is only fetched for a note that has one, once.

let loading = null

function loadMermaid() {
  if (!loading) {
    loading = import('mermaid').then(({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        theme: 'dark',
        themeVariables: {
          darkMode: true,
          background: '#12132a',
          primaryColor: '#1a1b3a',
          primaryTextColor: '#f0f0ff',
          primaryBorderColor: '#8a5cf5',
          lineColor: '#a78bfa',
          secondaryColor: '#1a1b3a',
          tertiaryColor: '#12132a',
          // Gantt task labels that don't fit inside their bar are drawn outside it,
          // against the diagram background rather than the bar. Mermaid accounts
          // for that on :done tasks (it swaps in taskTextOutsideColor) but not on
          // :active ones, which keep taskTextDarkColor — meant for dark text on the
          // light active-task bar — even when placed outside on our dark bg, making
          // them invisible. Keeping this light fixes that; it only trades away
          // contrast for the (currently unused) case of a label short enough to
          // fit inside the light active bar itself.
          taskTextDarkColor: '#f0f0ff',
          taskTextColor: '#f0f0ff',
          taskTextLightColor: '#f0f0ff',
          taskTextOutsideColor: '#f0f0ff'
        }
      })
      return mermaid
    })
    // A failed download (offline) is tried again next time.
    loading.catch(() => { loading = null })
  }
  return loading
}

// Mermaid sizes diagrams (e.g. gantt) from the container's current
// offsetWidth. Right after the DOM patch the layout may not have settled yet
// (sibling panels still loading their own content), so wait until the
// container actually has width before rendering.
function waitForLayoutWidth(el, attempts = 0) {
  return new Promise((resolve) => {
    const check = (tries) => {
      if (el.offsetWidth > 0 || tries >= 10) requestAnimationFrame(resolve)
      else requestAnimationFrame(() => check(tries + 1))
    }
    check(attempts)
  })
}

/**
 * Draws the `pre.mermaid` blocks inside `root`. `isCurrent()` is asked after
 * each wait: false (the HTML was replaced, the view left) stops it.
 */
export async function renderMermaidIn(root, isCurrent = () => true) {
  if (!root.querySelector('pre.mermaid')) return
  let mermaid
  try {
    mermaid = await loadMermaid()
  } catch (err) {
    console.error('Failed to load Mermaid:', err)
    return
  }
  if (!isCurrent()) return
  await waitForLayoutWidth(root)
  if (!isCurrent()) return
  const diagrams = root.querySelectorAll('pre.mermaid')
  try {
    await mermaid.run({ nodes: diagrams })
  } catch (err) {
    console.error('Failed to render Mermaid diagram:', err)
  }
}
