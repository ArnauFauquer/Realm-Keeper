import { apiUrl } from '@/config/env'
import { DOC_TYPES } from '@/utils/docTypes'
import { encodePath } from '@/utils/paths'
import { httpClient as client } from './http'

/**
 * The client for one kind of document (see backend routes/doc_router.py):
 * createDocApi('encounters', { itemsKey: 'encounters' }). Its folders are the
 * Observatory's (api/observatory.js). Everything but the
 * `commands` is the same for every kind; `commands` only exist for live
 * documents, and each one returns the event the server announced (see
 * utils/applyEvent.js), which the caller applies at once without waiting for
 * it to come round on the socket.
 */
export function createDocApi(prefix, { itemsKey = prefix } = {}) {
  const base = `${apiUrl}/api/${prefix}`
  const docUrl = (id) => `${base}/${encodePath(id)}`
  const data = (res) => res.data

  return {
    itemsKey,
    base,

    fetchAll: () => client.get(`${base}/all`).then((res) => res.data[itemsKey]),
    fetch: (id) => client.get(docUrl(id)).then(data),
    // A document edited whole (charts, vistas): the new fields replace the stored ones.
    save: (id, fields) => client.put(docUrl(id), fields).then(data),
    // Sets its picture to an Observatory image, through the route that checks it: setAsset(id, 'image', url).
    setAsset: (id, route, url) => client.post(`${docUrl(id)}/${route}`, { url }).then(data),
    create: (name, description, folderPath = '') =>
      client.post(base, { name, description, folder_path: folderPath }).then(data),
    remove: (id) => client.delete(docUrl(id)).then(data),
    rename: (id, name) => client.post(`${base}/rename`, { id, name }).then(data),
    move: (id, folderPath) => client.post(`${base}/move`, { id, folder_path: folderPath }).then(data),

    commands: {
      patch: (id, fields) => client.patch(docUrl(id), fields).then(data),
      addItems: (id, collection, items, { ignoreExisting = false } = {}) =>
        client.post(`${docUrl(id)}/${collection}`, { items, ignore_existing: ignoreExisting }).then(data),
      patchItem: (id, collection, entityId, patch) =>
        client.patch(`${docUrl(id)}/${collection}/${encodeURIComponent(entityId)}`, patch).then(data),
      removeItem: (id, collection, entityId) =>
        client.delete(`${docUrl(id)}/${collection}/${encodeURIComponent(entityId)}`).then(data),
      orderItems: (id, collection, ids) => client.post(`${docUrl(id)}/${collection}/order`, { ids }).then(data),
      // Entries in or out of an entity's list (conditions, bars): relative, so
      // two people adding at once both add.
      editList: (id, collection, entityId, field, { add = [], remove = [] } = {}) =>
        client.post(`${docUrl(id)}/${collection}/${encodeURIComponent(entityId)}/list`, { field, add, remove }).then(data),
      adjust: (id, collection, entityId, resource, by) =>
        client.post(`${docUrl(id)}/${collection}/${encodeURIComponent(entityId)}/adjust`, { resource, by }).then(data),
      // A document's own counters (a character's).
      adjustOwn: (id, resource, by) => client.post(`${docUrl(id)}/adjust`, { resource, by }).then(data)
    }
  }
}

// One client per kind utils/docTypes.js describes, at its `resource`: a new
// kind gets its client from its entry there.
const apis = Object.fromEntries(Object.values(DOC_TYPES).map((kind) => [kind.type, createDocApi(kind.resource)]))

export const chartsApi = apis.chart
export const vistasApi = apis.vista
export const encountersApi = apis.encounter
export const charactersApi = apis.character
export const adversariesApi = apis.adversary
export const battlemapsApi = apis.battlemap

/** The client of a kind of document (utils/docTypes.js). */
export const docApi = (type) => apis[type]
