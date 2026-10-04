import { apiUrl } from '@/config/env'

/** The WebSocket URL of one of the backend's sockets ("/ws/screen", "/ws/sync"):
 * the page's own host (the web server proxies /ws to the backend), or the
 * API's when the app is built to talk to one directly. */
export function socketUrl(path) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  let host = window.location.host
  if (apiUrl) {
    const apiHost = apiUrl.replace(/^http(s)?:\/\//, '')
    // VITE_API_URL is "localhost:8000" but the page was opened through a LAN
    // address: reach the backend on that address, with the same port.
    if (apiHost.startsWith('localhost:') && window.location.hostname !== 'localhost') {
      host = `${window.location.hostname}:${apiHost.split(':')[1] || '8000'}`
    } else {
      host = apiHost
    }
  }
  return `${protocol}//${host}${path}`
}
