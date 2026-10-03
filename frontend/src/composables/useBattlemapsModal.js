import { createModalState } from './useModalState'

// Module-level (singleton): the Battlemaps modal, openable from anywhere.
const state = createModalState()

export function useBattlemapsModal() {
  return state
}
