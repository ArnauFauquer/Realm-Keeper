import { createModalState } from './useModalState'

// Module-level (singleton): lets any component open the same Encounters modal
// instance — a sheet's "Add to encounter" opens it on the encounter it added to.
const state = createModalState()

export function useEncountersModal() {
  return state
}
