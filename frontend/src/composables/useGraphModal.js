import { createModalState } from './useModalState'

// Module-level (singleton): lets any component (sidebar, right-panel link,
// etc.) open the same graph modal instance without prop-drilling through
// the tree, same pattern as the other *Modal composables.
const state = createModalState()

export function useGraphModal() {
  return state
}
