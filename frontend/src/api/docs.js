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
 * A keyed kind (characters) has documents named by what they belong to:
 * `ensure(id, fields)` makes one if there is none, `reassign(id, newId)` gives
 * it another id.
 */
export function createDocApi(prefix, { itemsKey = prefix } = {}) {
  const base = `${apiUrl}/api/${prefix}`
  const client = axios.create({ withCredentials: true })
  const docUrl = (id) => `${base}/${encodePath(id)}`
  const data = (res) => res.data

  return {
    itemsKey,
    base,

    fetchTree: (path = '') => client.get(base, { params: { path } }).then(data),
    fetchAll: () => client.get(`${base}/all`).then((res) => res.data[itemsKey]),
    fetch: (id) => client.get(docUrl(id)).then(data),
    // A document edited whole (charts, vistas): the new fields replace the stored ones.
    save: (id, fields) => client.put(docUrl(id), fields).then(data),
    // Sets its picture to a library image, through the route that checks it: setAsset(id, 'image', url).
    setAsset: (id, route, url) => client.post(`${docUrl(id)}/${route}`, { url }).then(data),
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
    ensure: (id, fields) => client.post(`${base}/ensure`, { id, fields }).then(data),
    reassign: (id, newId) => client.post(`${docUrl(id)}/reassign`, { id: newId }).then(data),

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
        client.post(`${docUrl(id)}/${collection}/${encodeURIComponent(entityId)}/adjust`, { resource, by }).then(data),
      // A document's own counters (a character's).
      adjustOwn: (id, resource, by) => client.post(`${docUrl(id)}/adjust`, { resource, by }).then(data)
    }
  }
}

export const chartsApi = createDocApi('charts')
export const vistasApi = createDocApi('vistas')
export const encountersApi = createDocApi('encounters')
export const charactersApi = createDocApi('characters')
export const battlemapsApi = createDocApi('battlemaps')

const apis = { chart: chartsApi, vista: vistasApi, encounter: encountersApi, battlemap: battlemapsApi, character: charactersApi }

/** The client of a kind of document (utils/docTypes.js). */
export const docApi = (type) => apis[type]
