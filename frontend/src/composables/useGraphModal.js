import { ref } from 'vue'

// Module-level (singleton): lets any component (sidebar, right-panel link, etc.)
// open the same graph modal instance without prop-drilling through the tree.
const isOpen = ref(false)

export function useGraphModal() {
  return {
    isOpen,
    open: () => { isOpen.value = true },
    close: () => { isOpen.value = false }
  }
}
