import axios from 'axios'
import { apiUrl } from '@/config/env'

export async function getCurrentUser() {
  const res = await axios.get(`${apiUrl}/api/auth/me`, { withCredentials: true })
  return res.data
}

export async function logout() {
  await axios.post(`${apiUrl}/api/auth/logout`, {}, { withCredentials: true })
}

export function loginUrl() {
  return `${apiUrl}/api/auth/login`
}
