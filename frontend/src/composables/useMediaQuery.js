import { onBeforeUnmount, ref } from 'vue'

/**
 * Whether a media query matches, kept up to date. For parts that should not
 * exist at all (not just be hidden by CSS) at some sizes, so they don't
 * fetch or animate where nobody sees them.
 */
export function useMediaQuery(query) {
  const list = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query) : null
  const matches = ref(list ? list.matches : false)
  if (!list) return matches

  const onChange = (event) => { matches.value = event.matches }
  list.addEventListener('change', onChange)
  onBeforeUnmount(() => list.removeEventListener('change', onChange))
  return matches
}
