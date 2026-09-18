import axios from 'axios'
import { apiUrl } from '@/config/env'

const base = `${apiUrl}/api/asset-library`
const client = axios.create({ withCredentials: true })

export async function fetchLibraryAssets() {
  const res = await client.get(base)
  return res.data
}

export async function createLibraryAsset(name, folderId) {
  const res = await client.post(base, { name, folder_id: folderId ?? null })
  return res.data
}

export async function updateLibraryAsset(itemId, name, folderId) {
  const res = await client.put(`${base}/${encodeURIComponent(itemId)}`, { name, folder_id: folderId ?? null })
  return res.data
}

export async function deleteLibraryAsset(itemId) {
  await client.delete(`${base}/${encodeURIComponent(itemId)}`)
}

export async function uploadLibraryAssetImage(itemId, file, onProgress) {
  const formData = new FormData()
  formData.append('file', file)
  const res = await client.post(`${base}/${encodeURIComponent(itemId)}/image`, formData, {
    onUploadProgress: onProgress ? (e) => onProgress(e.total ? e.loaded / e.total : 0) : undefined
  })
  return res.data
}

export async function fetchLibraryFolders() {
  const res = await client.get(`${base}/folders`)
  return res.data
}

export async function createLibraryFolder(name, parentId) {
  const res = await client.post(`${base}/folders`, { name, parent_id: parentId ?? null })
  return res.data
}

export async function renameLibraryFolder(folderId, name) {
  const res = await client.put(`${base}/folders/${encodeURIComponent(folderId)}`, { name })
  return res.data
}

export async function deleteLibraryFolder(folderId) {
  await client.delete(`${base}/folders/${encodeURIComponent(folderId)}`)
}
