import axios from 'axios'
import { apiUrl } from '@/config/env'

const base = `${apiUrl}/api/player`
const client = axios.create({ withCredentials: true })

function encodeKey(key) {
  return key.split('/').map(encodeURIComponent).join('/')
}

export async function fetchAlbums() {
  const res = await client.get(`${base}/albums`)
  return res.data.albums
}

export async function createAlbum(name) {
  await client.post(`${base}/albums`, { name })
}

export async function deleteAlbum(name) {
  await client.delete(`${base}/albums/${encodeURIComponent(name)}`)
}

export async function renameAlbum(oldName, newName) {
  await client.put(`${base}/albums/${encodeURIComponent(oldName)}`, { name: newName })
}

export async function fetchTracks(album) {
  const res = await client.get(`${base}/albums/${encodeURIComponent(album)}/tracks`)
  return res.data.tracks
}

export async function uploadTrack(album, file, onProgress) {
  const formData = new FormData()
  formData.append('file', file)
  await client.post(`${base}/albums/${encodeURIComponent(album)}/tracks`, formData, {
    onUploadProgress: onProgress
      ? (e) => onProgress(e.total ? e.loaded / e.total : 0)
      : undefined
  })
}

export async function deleteTrack(key) {
  await client.delete(`${base}/tracks/${encodeKey(key)}`)
}

export async function moveTrack(key, album) {
  const res = await client.post(`${base}/tracks/move`, { key, album })
  return res.data
}

export function streamUrl(key) {
  return `${base}/stream/${encodeKey(key)}`
}
