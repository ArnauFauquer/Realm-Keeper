import { ref } from 'vue'

// Builds a module-level (singleton) open/close state for a modal, so any
// component can open the same instance without prop-drilling through the
// tree. Call this once at module scope in a modal-specific composable file
// (e.g. useVistasModal.js) — each call gets its own independent `isOpen`.
//
// `open(itemId)` can also ask the modal to jump straight to one item (e.g. a
// chart embedded in a note) instead of its gallery; the modal reads and
// clears `targetId` when it opens. Anything that isn't a string (such as the
// click event from a plain `@click="open"`) is ignored.
export function createModalState() {
  const isOpen = ref(false)
  const targetId = ref(null)
  return {
    isOpen,
    targetId,
    open: (itemId) => {
      targetId.value = typeof itemId === 'string' ? itemId : null
      isOpen.value = true
    },
    close: () => { isOpen.value = false }
  }
}
