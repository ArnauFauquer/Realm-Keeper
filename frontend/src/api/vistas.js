import axios from 'axios'
import { apiUrl } from '@/config/env'

const base = `${apiUrl}/api/vistas`
const client = axios.create({ withCredentials: true })

export async function fetchVistas() {
  const res = await client.get(base)
  return res.data
}

export async function fetchVista(vistaId) {
  const res = await client.get(`${base}/${encodeURIComponent(vistaId)}`)
  return res.data
}

export async function createVista(name, description) {
  const res = await client.post(base, { name, description })
  return res.data
}

export async function saveVista(vistaId, { name, description, vanishing_point, background_offset_y, assets }) {
  const res = await client.put(`${base}/${encodeURIComponent(vistaId)}`, {
    name, description, vanishing_point, background_offset_y, assets
  })
  return res.data
}

export async function deleteVista(vistaId) {
  await client.delete(`${base}/${encodeURIComponent(vistaId)}`)
}

export async function uploadVistaBackground(vistaId, file, onProgress) {
  const formData = new FormData()
  formData.append('file', file)
  const res = await client.post(`${base}/${encodeURIComponent(vistaId)}/background`, formData, {
    onUploadProgress: onProgress ? (e) => onProgress(e.total ? e.loaded / e.total : 0) : undefined
  })
  return res.data
}
