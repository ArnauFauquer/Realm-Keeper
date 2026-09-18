import axios from 'axios'
import { apiUrl } from '@/config/env'

const base = `${apiUrl}/api/charts`
const client = axios.create({ withCredentials: true })

export async function fetchCharts() {
  const res = await client.get(base)
  return res.data
}

export async function fetchChart(chartId) {
  const res = await client.get(`${base}/${encodeURIComponent(chartId)}`)
  return res.data
}

export async function createChart(name, description) {
  const res = await client.post(base, { name, description })
  return res.data
}

export async function saveChart(chartId, { name, description, pins, paths, annotations }) {
  const res = await client.put(`${base}/${encodeURIComponent(chartId)}`, {
    name, description, pins, paths, annotations
  })
  return res.data
}

export async function deleteChart(chartId) {
  await client.delete(`${base}/${encodeURIComponent(chartId)}`)
}

export async function uploadChartImage(chartId, file, onProgress) {
  const formData = new FormData()
  formData.append('file', file)
  const res = await client.post(`${base}/${encodeURIComponent(chartId)}/image`, formData, {
    onUploadProgress: onProgress ? (e) => onProgress(e.total ? e.loaded / e.total : 0) : undefined
  })
  return res.data
}

export async function uploadPinIcon(chartId, pinId, file, onProgress) {
  const formData = new FormData()
  formData.append('file', file)
  const res = await client.post(
    `${base}/${encodeURIComponent(chartId)}/pins/${encodeURIComponent(pinId)}/icon`,
    formData,
    { onUploadProgress: onProgress ? (e) => onProgress(e.total ? e.loaded / e.total : 0) : undefined }
  )
  return res.data
}
