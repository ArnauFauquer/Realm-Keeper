// Brings a document up to date with one change the server announced (see
// diff_docs in backend/services/sync_hub.py, whose cases are shared with
// tests/applyEvent.test.js). `set` replaces whole fields; for lists of
// {id: ...} entities, `upsert` replaces or appends by id, `remove` drops by
// id, and `order` is the ids in their new sequence.
export function applyEvent(doc, event) {
  for (const [key, value] of Object.entries(event.set || {})) {
    doc[key] = value
  }
  for (const [key, items] of Object.entries(event.upsert || {})) {
    const list = doc[key] || (doc[key] = [])
    for (const item of items) {
      const index = list.findIndex((entity) => entity.id === item.id)
      if (index === -1) list.push(item)
      else list[index] = item
    }
  }
  for (const [key, ids] of Object.entries(event.remove || {})) {
    if (doc[key]) doc[key] = doc[key].filter((entity) => !ids.includes(entity.id))
  }
  for (const [key, ids] of Object.entries(event.order || {})) {
    const byId = new Map((doc[key] || []).map((entity) => [entity.id, entity]))
    doc[key] = ids.map((id) => byId.get(id)).filter(Boolean)
  }
  if (event.rev !== undefined) doc.rev = event.rev
  return doc
}
