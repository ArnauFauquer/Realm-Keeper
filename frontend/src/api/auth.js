import { apiUrl } from '@/config/env'
import { httpClient } from './http'

export async function getCurrentUser() {
  const res = await httpClient.get(`${apiUrl}/api/auth/me`)
  return res.data
}

export async function logout() {
  await httpClient.post(`${apiUrl}/api/auth/logout`, {})
}

export function loginUrl() {
  return `${apiUrl}/api/auth/login`
}
