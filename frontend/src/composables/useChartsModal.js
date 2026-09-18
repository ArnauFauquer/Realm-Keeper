import { ref } from 'vue'

// Module-level (singleton): lets any component open the same Charts modal
// instance without prop-drilling through the tree, same pattern as useGraphModal.
const isOpen = ref(false)

export function useChartsModal() {
  return {
    isOpen,
    open: () => { isOpen.value = true },
    close: () => { isOpen.value = false }
  }
}
