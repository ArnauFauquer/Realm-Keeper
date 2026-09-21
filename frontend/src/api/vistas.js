import axios from 'axios'
import { apiUrl } from '@/config/env'

const base = `${apiUrl}/api/vistas`
const client = axios.create({ withCredentials: true })

// vista/folder ids can be multi-segment paths ("npcs/tavern-vista") — encode
// each segment on its own so the "/" survives as a path separator instead of
// being escaped to %2F.
function encodePath(id) {
  return id.split('/').map(encodeURIComponent).join('/')
}

export async function fetchVistaTree(path = '') {
  const res = await client.get(base, { params: { path } })
  return res.data
}

export async function fetchVista(vistaId) {
  const res = await client.get(`${base}/${encodePath(vistaId)}`)
  return res.data
}

export async function createVista(name, description, folderPath = '') {
  const res = await client.post(base, { name, description, folder_path: folderPath })
  return res.data
}

export async function saveVista(vistaId, { name, description, vanishing_point, background_offset_y, assets }) {
  const res = await client.put(`${base}/${encodePath(vistaId)}`, {
    name, description, vanishing_point, background_offset_y, assets
  })
  return res.data
}

export async function deleteVista(vistaId) {
  await client.delete(`${base}/${encodePath(vistaId)}`)
}

export async function uploadVistaBackground(vistaId, file, onProgress) {
  const formData = new FormData()
  formData.append('file', file)
  const res = await client.post(`${base}/${encodePath(vistaId)}/background`, formData, {
    onUploadProgress: onProgress ? (e) => onProgress(e.total ? e.loaded / e.total : 0) : undefined
  })
  return res.data
}

export async function createVistaFolder(path) {
  await client.post(`${base}/folders`, { path })
}

export async function renameVistaFolder(path, name) {
  await client.put(`${base}/folders/${encodePath(path)}`, { name })
}

export async function deleteVistaFolder(path) {
  await client.delete(`${base}/folders/${encodePath(path)}`)
}

export async function moveVistaFolder(path, destParentPath) {
  await client.post(`${base}/folders/move`, { path, dest_parent_path: destParentPath })
}

export async function moveVista(vistaId, folderPath) {
  const res = await client.post(`${base}/move`, { vista_id: vistaId, folder_path: folderPath })
  return res.data
}
