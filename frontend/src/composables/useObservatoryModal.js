import { createModalState } from './useModalState'

// Module-level (singleton): the Observatory every part of the app opens, from
// the sidebar or on the way back from a document's editor. `open(path)` opens
// it at a folder ("act 2/caves"); `open()` at the top.
const state = createModalState()

export function useObservatoryModal() {
  return state
}

/** The folder a document or image is in: "act 2/caves/fight" -> "act 2/caves". */
export const folderOf = (id) => (id && id.includes('/') ? id.slice(0, id.lastIndexOf('/')) : '')
