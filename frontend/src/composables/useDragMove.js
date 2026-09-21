import { ref } from 'vue'

// Generic HTML5 drag-and-drop mechanics, shared by every folder/list browser
// (asset library, vistas, charts, the player's albums) so each one doesn't
// reimplement its own dragstart/dragover/drop bookkeeping. It knows nothing
// about what's being dragged or what a "move" means — the caller supplies
// both via the item passed to startDrag() and the onMove callback passed to
// drop().
export function useDragMove() {
  const draggedItem = ref(null)
  const dragOverTarget = ref(null)

  function startDrag(item) {
    draggedItem.value = item
  }

  function endDrag() {
    draggedItem.value = null
    dragOverTarget.value = null
  }

  function dragOver(target) {
    dragOverTarget.value = target
  }

  function dragLeave(target) {
    if (dragOverTarget.value === target) dragOverTarget.value = null
  }

  async function drop(target, onMove) {
    const item = draggedItem.value
    draggedItem.value = null
    dragOverTarget.value = null
    if (!item) return
    await onMove(item, target)
  }

  return { draggedItem, dragOverTarget, startDrag, endDrag, dragOver, dragLeave, drop }
}
