import { ref } from 'vue'

// Module-level (singleton): lets any component open the same Vistas modal
// instance without prop-drilling through the tree, same pattern as useChartsModal.
const isOpen = ref(false)

export function useVistasModal() {
  return {
    isOpen,
    open: () => { isOpen.value = true },
    close: () => { isOpen.value = false }
  }
}
