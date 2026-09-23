import { ref } from 'vue'
import { getCurrentUser, logout as apiLogout, loginUrl } from '@/api/auth'

// Module-level (singleton): one shared auth state for the whole app.
const user = ref(null)
const loading = ref(true)
const checked = ref(false)

async function checkAuth() {
  loading.value = true
  try {
    user.value = await getCurrentUser()
  } catch (e) {
    user.value = null
  } finally {
    loading.value = false
    checked.value = true
  }
}

function login() {
  window.location.href = loginUrl()
}

async function logout() {
  await apiLogout()
  user.value = null
  await clearCachedApiResponses()
}

// The service worker keeps API responses around for offline use (see
// public/sw.js). Drop them on logout so nothing fetched while logged in can
// be served back to whoever uses this browser next.
async function clearCachedApiResponses() {
  if (typeof caches === 'undefined') return
  try {
    for (const name of await caches.keys()) {
      const cache = await caches.open(name)
      for (const request of await cache.keys()) {
        if (new URL(request.url).pathname.startsWith('/api/')) await cache.delete(request)
      }
    }
  } catch (e) {
    // Cache Storage can be unavailable (private windows, blocked storage).
  }
}

export function useAuth() {
  return { user, loading, checked, checkAuth, login, logout }
}
