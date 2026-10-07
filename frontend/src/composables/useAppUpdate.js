import { ref } from 'vue'

// A tab left open across a deploy runs the old build: whatever it loads only
// when first needed (the 3D dice, an editor) is asked for under its old file
// name, which the server no longer has. The import fails, and the feature
// quietly isn't there (the dice roll flat) until the page is reloaded. Vite
// reports such a failure as `vite:preloadError`; this turns it into `stale`,
// for the app to offer a reload.

/** True once this tab's build turned out to be older than the server's. */
const stale = ref(false)
let watching = false

/** Starts listening for chunks that can't be loaded any more (once per page). */
export function watchForUpdates() {
  if (watching || typeof window === 'undefined') return
  watching = true
  // Not prevented: whoever imported still gets the error, and falls back.
  window.addEventListener('vite:preloadError', () => { stale.value = true })
}

export function useAppUpdate() {
  return {
    stale,
    reload: () => window.location.reload()
  }
}
