import { ref } from 'vue'
import { socketUrl } from '@/utils/socketUrl'

// The one connection to /ws/sync (see backend routes/sync.py), shared by every
// live document on the page: it carries every change to any of them, and a
// document only takes the ones that are its own. It is opened when the first
// document needs it and closed when the last lets go.

const RETRY_MIN = 1000
const RETRY_MAX = 10000

/** 'idle' | 'connecting' | 'open' | 'denied' (not signed in) */
export const syncStatus = ref('idle')

const eventHandlers = new Set()
const openHandlers = new Set()
let socket = null
let users = 0
let retryTimer = null
let delay = RETRY_MIN

function open() {
  if (socket || users === 0) return
  syncStatus.value = 'connecting'
  const ws = new WebSocket(socketUrl('/ws/sync'))
  socket = ws

  ws.onopen = () => {
    delay = RETRY_MIN
    syncStatus.value = 'open'
    // Changes made while it was down were missed: whoever holds a document
    // reloads it on every (re)connection.
    openHandlers.forEach((handler) => handler())
  }

  ws.onmessage = (message) => {
    let event
    try {
      event = JSON.parse(message.data)
    } catch {
      return
    }
    eventHandlers.forEach((handler) => handler(event))
  }

  ws.onclose = (closeEvent) => {
    socket = null
    if (users === 0) {
      syncStatus.value = 'idle'
    } else if (closeEvent.code === 1008) {
      // Policy violation: not signed in. Retrying can't help.
      syncStatus.value = 'denied'
    } else {
      syncStatus.value = 'connecting'
      retryTimer = setTimeout(() => {
        retryTimer = null
        open()
      }, delay)
      delay = Math.min(delay * 2, RETRY_MAX)
    }
  }
}

/** Starts listening: `onEvent(event)` for each change announced, `onOpen()`
 * whenever the connection (re)opens. Returns the function that stops. */
export function listenToSync({ onEvent, onOpen }) {
  eventHandlers.add(onEvent)
  openHandlers.add(onOpen)
  users += 1
  if (socket && socket.readyState === 1) onOpen()
  open()

  return () => {
    eventHandlers.delete(onEvent)
    openHandlers.delete(onOpen)
    users -= 1
    if (users === 0) {
      clearTimeout(retryTimer)
      retryTimer = null
      if (socket) {
        socket.onclose = null
        socket.close()
        socket = null
      }
      syncStatus.value = 'idle'
    }
  }
}
