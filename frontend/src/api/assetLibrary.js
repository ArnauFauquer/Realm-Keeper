import axios from 'axios'
import { apiUrl } from '@/config/env'

const base = `${apiUrl}/api/asset-library`
const client = axios.create({ withCredentials: true })

export async function fetchLibraryContents(path = '') {
  const res = await client.get(base, { params: { path } })
  return res.data
}

export async function createLibraryFolder(path) {
  await client.post(`${base}/folders`, { path })
}

export async function renameLibraryFolder(path, name) {
  await client.put(`${base}/folders/${path.split('/').map(encodeURIComponent).join('/')}`, { name })
}

export async function deleteLibraryFolder(path) {
  await client.delete(`${base}/folders/${path.split('/').map(encodeURIComponent).join('/')}`)
}

export async function uploadLibraryAsset(path, file, onProgress) {
  const formData = new FormData()
  formData.append('path', path)
  formData.append('file', file)
  const res = await client.post(`${base}/assets`, formData, {
    onUploadProgress: onProgress ? (e) => onProgress(e.total ? e.loaded / e.total : 0) : undefined
  })
  return res.data
}

export async function deleteLibraryAsset(key) {
  await client.delete(`${base}/assets/${key.split('/').map(encodeURIComponent).join('/')}`)
}
