import axios from 'axios'
import { apiUrl } from '@/config/env'
import { encodePath } from './docs'

// The Observatory (backend routes/observatory.py): one tree of folders for
// every document and image. A folder's contents come as { folders, items },
// each item with its `kind` ("chart", "encounter"... or "image"). Documents are
// created, renamed, moved and deleted through their own kind's client
// (api/docs.js); images and folders through this one.
const base = `${apiUrl}/api/observatory`
const client = axios.create({ withCredentials: true })
const data = (res) => res.data

export const observatoryApi = {
  list: (path = '') => client.get(base, { params: { path } }).then(data),

  createFolder: (path) => client.post(`${base}/folders`, { path }).then(data),
  renameFolder: (path, name) => client.put(`${base}/folders/${encodePath(path)}`, { name }).then(data),
  removeFolder: (path) => client.delete(`${base}/folders/${encodePath(path)}`).then(data),
  moveFolder: (path, destParentPath) =>
    client.post(`${base}/folders/move`, { path, dest_parent_path: destParentPath }).then(data),

  // An image is named by its file name ("1a2b3c4d-cave.png"), the last part of its URL.
  uploadImage: (path, file) => {
    const form = new FormData()
    form.append('path', path)
    form.append('file', file)
    return client.post(`${base}/images`, form).then(data)
  },
  renameImage: (id, name) => client.post(`${base}/images/rename`, { id, name }).then(data),
  moveImage: (id, folderPath) => client.post(`${base}/images/move`, { id, folder_path: folderPath }).then(data),
  removeImage: (id) => client.delete(`${base}/images/${encodeURIComponent(id)}`).then(data),

  // A backup of a folder (everything at the top), as a zip to download.
  exportUrl: (path = '') => `${base}/export${path ? `?path=${encodeURIComponent(path)}` : ''}`,
  // Puts a backup back where it was: { restored, skipped: [{ path, reason }] }.
  importBackup: (file) => {
    const form = new FormData()
    form.append('file', file)
    return client.post(`${base}/import`, form).then(data)
  }
}
