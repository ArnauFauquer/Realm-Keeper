import { createModalState } from './useModalState'

// Module-level (singleton): lets any component open the same Charts modal
// instance without prop-drilling through the tree, same pattern as the
// other *Modal composables.
const state = createModalState()

export function useChartsModal() {
  return state
}
