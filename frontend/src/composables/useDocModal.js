import { createModalState } from './useModalState'

// The open/close state of each kind's modal (utils/docTypes.js), shared by
// whoever opens it: the sidebar's buttons, a note's embed, a sheet's "Add to
// encounter". One instance per kind, made when it is first asked for.
const modals = {}

export function useDocModal(type) {
  return (modals[type] ||= createModalState())
}
