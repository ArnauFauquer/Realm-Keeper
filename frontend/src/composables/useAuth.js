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
}

export function useAuth() {
  return { user, loading, checked, checkAuth, login, logout }
}
