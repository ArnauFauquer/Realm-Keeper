import axios from 'axios'
import { apiUrl } from '@/config/env'

const base = `${apiUrl}/api/charts`
const client = axios.create({ withCredentials: true })

// chart/folder ids can be multi-segment paths ("npcs/tavern-map") — encode
// each segment on its own so the "/" survives as a path separator instead of
// being escaped to %2F.
function encodePath(id) {
  return id.split('/').map(encodeURIComponent).join('/')
}

export async function fetchChartTree(path = '') {
  const res = await client.get(base, { params: { path } })
  return res.data
}

export async function fetchChart(chartId) {
  const res = await client.get(`${base}/${encodePath(chartId)}`)
  return res.data
}

export async function createChart(name, description, folderPath = '') {
  const res = await client.post(base, { name, description, folder_path: folderPath })
  return res.data
}

export async function saveChart(chartId, { name, description, pins, paths, annotations }) {
  const res = await client.put(`${base}/${encodePath(chartId)}`, {
    name, description, pins, paths, annotations
  })
  return res.data
}

export async function deleteChart(chartId) {
  await client.delete(`${base}/${encodePath(chartId)}`)
}

export async function uploadChartImage(chartId, file, onProgress) {
  const formData = new FormData()
  formData.append('file', file)
  const res = await client.post(`${base}/${encodePath(chartId)}/image`, formData, {
    onUploadProgress: onProgress ? (e) => onProgress(e.total ? e.loaded / e.total : 0) : undefined
  })
  return res.data
}

export async function uploadPinIcon(chartId, pinId, file, onProgress) {
  const formData = new FormData()
  formData.append('file', file)
  const res = await client.post(
    `${base}/${encodePath(chartId)}/pins/${encodeURIComponent(pinId)}/icon`,
    formData,
    { onUploadProgress: onProgress ? (e) => onProgress(e.total ? e.loaded / e.total : 0) : undefined }
  )
  return res.data
}

export async function createChartFolder(path) {
  await client.post(`${base}/folders`, { path })
}

export async function renameChartFolder(path, name) {
  await client.put(`${base}/folders/${encodePath(path)}`, { name })
}

export async function deleteChartFolder(path) {
  await client.delete(`${base}/folders/${encodePath(path)}`)
}

export async function moveChartFolder(path, destParentPath) {
  await client.post(`${base}/folders/move`, { path, dest_parent_path: destParentPath })
}

export async function moveChart(chartId, folderPath) {
  const res = await client.post(`${base}/move`, { chart_id: chartId, folder_path: folderPath })
  return res.data
}
