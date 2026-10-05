import { getCurrentScope, onScopeDispose, ref } from 'vue'

// A short-lived "it worked" state for a button ("Sent!" for two seconds after
// sending to the screen). `on` is true for `ms` after each `flash()`, a second
// flash starts the time again, and the timer goes with the component, so it
// never fires on one that is gone.
export function useFlash(ms = 2000) {
  const on = ref(false)
  let timer = null

  function flash() {
    on.value = true
    clearTimeout(timer)
    timer = setTimeout(() => { on.value = false }, ms)
  }

  if (getCurrentScope()) onScopeDispose(() => clearTimeout(timer))

  return { on, flash }
}
