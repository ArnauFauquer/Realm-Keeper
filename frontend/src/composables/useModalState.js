import { ref } from 'vue'

// Builds a module-level (singleton) open/close state for a modal, so any
// component can open the same instance without prop-drilling through the
// tree. Call this once at module scope in a modal-specific composable file
// (e.g. useVistasModal.js) — each call gets its own independent `isOpen`.
export function createModalState() {
  const isOpen = ref(false)
  return {
    isOpen,
    open: () => { isOpen.value = true },
    close: () => { isOpen.value = false }
  }
}
