import { apiUrl } from '@/config/env'
import { httpClient } from './http'

export async function getCurrentUser() {
  const res = await httpClient.get(`${apiUrl}/api/auth/me`)
  return res.data
}

export async function logout() {
  await httpClient.post(`${apiUrl}/api/auth/logout`, {})
}

// Every provider comes back to the same callback; without one, the backend
// picks the first it has.
export function loginUrl(provider) {
  const query = provider ? `?provider=${encodeURIComponent(provider)}` : ''
  return `${apiUrl}/api/auth/login${query}`
}

// Which sign-in providers the backend has (one button each), public.
export async function getAuthProviders() {
  const res = await httpClient.get(`${apiUrl}/api/auth/providers`)
  return res.data
}
