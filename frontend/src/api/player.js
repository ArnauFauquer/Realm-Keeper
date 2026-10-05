import { apiUrl } from '@/config/env'
import { encodePath } from '@/utils/paths'
import { httpClient as client } from './http'

const base = `${apiUrl}/api/player`

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
    // An album's worth of music over a slow connection: no time limit.
    timeout: 0,
    onUploadProgress: onProgress
      ? (e) => onProgress(e.total ? e.loaded / e.total : 0)
      : undefined
  })
}

export async function deleteTrack(key) {
  await client.delete(`${base}/tracks/${encodePath(key)}`)
}

export async function moveTrack(key, album) {
  const res = await client.post(`${base}/tracks/move`, { key, album })
  return res.data
}

export async function renameTrack(key, name) {
  const res = await client.post(`${base}/tracks/rename`, { key, name })
  return res.data
}

export function streamUrl(key) {
  return `${base}/stream/${encodePath(key)}`
}
