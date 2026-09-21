import { onBeforeUnmount, onMounted } from 'vue'

// Warns before the tab closes/reloads while `hasUnsavedChanges` is true, and
// gives a `confirmDiscard()` check to gate in-app navigation (closing a
// modal, switching away from an editor) that would otherwise lose the same
// unsaved changes. Shared by the vista and chart editors.
export function useUnsavedChangesGuard(hasUnsavedChanges, message) {
  function onBeforeUnload(evt) {
    if (!hasUnsavedChanges.value) return
    evt.preventDefault()
    evt.returnValue = ''
  }
  onMounted(() => window.addEventListener('beforeunload', onBeforeUnload))
  onBeforeUnmount(() => window.removeEventListener('beforeunload', onBeforeUnload))

  function confirmDiscard() {
    return !hasUnsavedChanges.value || window.confirm(message)
  }

  return { confirmDiscard }
}
