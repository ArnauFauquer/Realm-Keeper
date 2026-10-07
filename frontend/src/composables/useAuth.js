import { ref } from 'vue'
import { getAuthProviders, getCurrentUser, logout as apiLogout, loginUrl } from '@/api/auth'

// Module-level (singleton): one shared auth state for the whole app.
const user = ref(null)
const loading = ref(true)
const checked = ref(false)
// The sign-in providers the backend has, once asked (null until then).
const providers = ref(null)
// Someone asked to sign in from a public page and there is more than one
// provider: the login gate opens to let them pick.
const choosingProvider = ref(false)

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

async function loadProviders() {
  if (providers.value) return providers.value
  try {
    providers.value = (await getAuthProviders()).providers || []
  } catch (e) {
    // An older backend without the list: its one provider, Google.
    providers.value = [{ id: 'google', name: 'Google' }]
  }
  return providers.value
}

// To the provider named; without one (the sidebar's "Sign in"), straight to
// the only provider there is, or to the gate to pick one of several.
async function login(provider) {
  if (typeof provider !== 'string') {
    const list = await loadProviders()
    if (list.length > 1) {
      choosingProvider.value = true
      return
    }
    provider = list[0]?.id
  }
  window.location.href = loginUrl(provider)
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
  return { user, loading, checked, providers, choosingProvider, checkAuth, loadProviders, login, logout }
}
