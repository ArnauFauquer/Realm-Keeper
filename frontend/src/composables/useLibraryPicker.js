import { computed, shallowRef } from 'vue'

/**
 * The Observatory opened as an image picker, for something: a canvas asks for
 * an image `for` one thing at a time (its map, a pin's icon, an asset), and
 * gets it back with what it was for. Wire it to <ObservatoryModal picker-mode>:
 * `:is-open="libraryOpen"`, `@close="closeLibrary"`, `@select="onLibrarySelect"`.
 *
 * `onPick(item, target)` is called with the chosen image and the target given
 * to `openLibrary(target)` (anything but null).
 */
export function useLibraryPicker(onPick) {
  const target = shallowRef(null)
  const libraryOpen = computed(() => target.value !== null)

  const openLibrary = (forWhat) => { target.value = forWhat }
  const closeLibrary = () => { target.value = null }

  function onLibrarySelect(item) {
    const forWhat = target.value
    target.value = null
    if (forWhat !== null) onPick(item, forWhat)
  }

  return { libraryOpen, libraryTarget: target, openLibrary, closeLibrary, onLibrarySelect }
}
