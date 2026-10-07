import { inject, onBeforeUnmount, provide, shallowRef } from 'vue'

// The header of DocumentModal has the same "Go live" and "Send to screen"
// buttons for every kind of document. A saved one (a chart, a vista) is sent
// by the modal itself; a live editor (the battlemap's) knows better what
// sending it means, so it hands the header its own: `useDocumentScreen`.

const DOCUMENT_SCREEN = Symbol('document-screen')

/**
 * For DocumentModal: what a live editor in it registered, or null. Its
 * `controls` are { live, sending, canSend (refs), send(), toggle(), liveHint }.
 */
export function provideDocumentScreen() {
  const controls = shallowRef(null)
  provide(DOCUMENT_SCREEN, (registered) => {
    controls.value = registered
    return () => { if (controls.value === registered) controls.value = null }
  })
  return controls
}

/** For an editor: its own screen buttons in the header of the modal it is in (none outside one). */
export function useDocumentScreen(controls) {
  const register = inject(DOCUMENT_SCREEN, null)
  if (!register) return
  onBeforeUnmount(register(controls))
}
