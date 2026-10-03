import axios from 'axios'
import { apiUrl } from '@/config/env'

// Document ids and folder paths can be several segments deep ("goblins/cave-
// ambush") — encode each segment on its own so the "/" stays a path separator
// instead of being escaped to %2F.
export function encodePath(id) {
  return id.split('/').map(encodeURIComponent).join('/')
}

/**
 * The client for one kind of document (see backend routes/doc_router.py):
 * createDocApi('encounters', { itemsKey: 'encounters' }). Everything but the
 * `commands` is the same for every kind; `commands` only exist for live
 * documents, and each one returns the event the server announced (see
 * utils/applyEvent.js), which the caller applies at once without waiting for
 * it to come round on the socket.
 *
 * A kind with exactly one document (`singleton`) has no ids in its URLs.
 */
export function createDocApi(prefix, { itemsKey = prefix, singleton = false } = {}) {
  const base = `${apiUrl}/api/${prefix}`
  const client = axios.create({ withCredentials: true })
  const docUrl = (id) => (singleton ? base : `${base}/${encodePath(id)}`)
  const data = (res) => res.data

  return {
    itemsKey,
    base,

    fetchTree: (path = '') => client.get(base, { params: { path } }).then(data),
    fetchAll: () => client.get(`${base}/all`).then((res) => res.data[itemsKey]),
    fetch: (id) => client.get(docUrl(id)).then(data),
    create: (name, description, folderPath = '') =>
      client.post(base, { name, description, folder_path: folderPath }).then(data),
    remove: (id) => client.delete(docUrl(id)).then(data),
    rename: (id, name) => client.post(`${base}/rename`, { id, name }).then(data),
    move: (id, folderPath) => client.post(`${base}/move`, { id, folder_path: folderPath }).then(data),
    createFolder: (path) => client.post(`${base}/folders`, { path }).then(data),
    renameFolder: (path, name) => client.put(`${base}/folders/${encodePath(path)}`, { name }).then(data),
    removeFolder: (path) => client.delete(`${base}/folders/${encodePath(path)}`).then(data),
    moveFolder: (path, destParentPath) =>
      client.post(`${base}/folders/move`, { path, dest_parent_path: destParentPath }).then(data),

    commands: {
      patch: (id, fields) => client.patch(docUrl(id), fields).then(data),
      addItems: (id, collection, items, { ignoreExisting = false } = {}) =>
        client.post(`${docUrl(id)}/${collection}`, { items, ignore_existing: ignoreExisting }).then(data),
      patchItem: (id, collection, entityId, patch) =>
        client.patch(`${docUrl(id)}/${collection}/${encodeURIComponent(entityId)}`, patch).then(data),
      removeItem: (id, collection, entityId) =>
        client.delete(`${docUrl(id)}/${collection}/${encodeURIComponent(entityId)}`).then(data),
      orderItems: (id, collection, ids) => client.post(`${docUrl(id)}/${collection}/order`, { ids }).then(data),
      adjust: (id, collection, entityId, resource, by) =>
        client.post(`${docUrl(id)}/${collection}/${encodeURIComponent(entityId)}/adjust`, { resource, by }).then(data)
    }
  }
}

export const encountersApi = createDocApi('encounters')
export const charactersApi = createDocApi('characters', { singleton: true })
