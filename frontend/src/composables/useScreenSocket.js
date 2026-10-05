import { getCurrentInstance, onBeforeUnmount, ref } from 'vue'
import { socketUrl } from '@/utils/socketUrl'
import { pairScreen } from '@/api/screen'

// The /screen view's connection to /ws/screen (see backend routes/screen.py):
// pairing from a screen link, the socket itself, and reconnecting for as long
// as the view is up. A screen is often a TV nobody touches, so it never gives
// up - but waits longer between tries the longer the backend stays away
// (doubling, capped), with some jitter so the screens of a restarted backend
// don't all knock at the same instant.

const RETRY_MIN = 1000
const RETRY_MAX = 30000

/** How long to wait before reconnection attempt number `attempt` (0 first):
 * between half and all of RETRY_MIN * 2^attempt, capped at RETRY_MAX. */
export function retryDelay(attempt, random = Math.random) {
  const ceiling = Math.min(RETRY_MIN * 2 ** attempt, RETRY_MAX)
  return ceiling / 2 + random() * (ceiling / 2)
}

/**
 * `onMessage(data)` gets every message, parsed; `onOpen()` runs on every
 * (re)connection. `start()` pairs (if the page was opened from a screen link)
 * and connects; everything stops when the component unmounts, or on `stop()`.
 * `notPaired` is set while the backend refuses the screen (close code 1008:
 * neither signed in nor paired); `pairError` when a screen link didn't work.
 */
export function useScreenSocket({ onMessage, onOpen } = {}) {
  const notPaired = ref(false)
  const pairError = ref('')
  let ws = null
  let retryTimer = null
  let attempt = 0
  let stopped = false

  // Opened from a screen link (/screen#key=...): pair this device, then drop
  // the key from the address bar (the pairing cookie is what's used from
  // here on). Returns whether a key was there to pair with.
  async function pairFromHash() {
    const key = new URLSearchParams(window.location.hash.slice(1)).get('key')
    if (!key) return false
    pairError.value = ''
    try {
      await pairScreen(key)
    } catch {
      pairError.value = 'This screen link is invalid or has expired.'
    }
    window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
    return true
  }

  // Detach before closing: onclose schedules a reconnect, which must not
  // fire for a socket being replaced or left behind.
  function close() {
    clearTimeout(retryTimer)
    retryTimer = null
    if (!ws) return
    ws.onopen = ws.onmessage = ws.onclose = null
    ws.close()
    ws = null
  }

  function connect() {
    close()
    if (stopped) return
    const socket = new WebSocket(socketUrl('/ws/screen'))
    ws = socket
    let opened = false

    socket.onmessage = (event) => {
      let data
      try {
        data = JSON.parse(event.data)
      } catch (e) {
        console.error('Unreadable screen message:', e)
        return
      }
      try {
        onMessage?.(data)
      } catch (e) {
        console.error('Error handling screen message:', e)
      }
    }

    socket.onopen = () => {
      opened = true
      notPaired.value = false
      onOpen?.()
    }

    // No onerror: a failed connection also closes, and onclose retries.
    socket.onclose = (event) => {
      ws = null
      // 1008: neither signed in nor paired. Keep retrying anyway - pairing
      // (or signing in) in another tab of this browser fixes it. The backend
      // accepts before refusing, so such a socket did open: it still backs off.
      if (event.code === 1008) notPaired.value = true
      else if (opened) attempt = 0
      retryTimer = setTimeout(connect, retryDelay(attempt))
      attempt += 1
    }
  }

  // A screen link pasted into a tab already on /screen only changes the
  // #fragment, which doesn't remount the view. Reconnect so the socket
  // carries the new pairing cookie.
  async function onHashChange() {
    if (!(await pairFromHash()) || stopped) return
    attempt = 0
    connect()
  }

  async function start() {
    await pairFromHash()
    if (stopped) return
    window.addEventListener('hashchange', onHashChange)
    connect()
  }

  function stop() {
    stopped = true
    window.removeEventListener('hashchange', onHashChange)
    close()
  }

  if (getCurrentInstance()) onBeforeUnmount(stop)

  return { notPaired, pairError, start, stop }
}
