import { ref, computed, shallowRef, watch, onBeforeUnmount } from 'vue'
import { applyEvent } from '@/utils/applyEvent'
import { listenToSync } from './syncSocket'

// A live document (see backend services/sync_hub.py) held in the page and kept
// up to date: loaded once, then changed by the events the server announces.
// Whoever changes it sends a command (api.commands.*) and hands the returned
// event to `apply`; the same event also arrives on the socket, and the `rev`
// it carries tells it has been seen. One copy per document, shared by every
// component that asks for it.

const entries = new Map()

function createEntry(key, fetchDoc) {
  const doc = ref(null)
  const status = ref('loading') // 'loading' | 'ready' | 'error' | 'gone'
  const error = ref(null)
  let early = [] // events that arrived while the first copy was still on its way
  let loading = null
  let users = 0
  let stopListening = null

  function load() {
    if (loading) return loading
    loading = (async () => {
      try {
        const snapshot = await fetchDoc()
        const pending = early.filter((event) => event.rev > snapshot.rev).sort((a, b) => a.rev - b.rev)
        early = []
        doc.value = snapshot
        // Let go before replaying: apply() holds events back while loading.
        loading = null
        pending.forEach(apply)
        status.value = 'ready'
        error.value = null
      } catch (err) {
        status.value = err.response?.status === 404 ? 'gone' : 'error'
        error.value = err.response?.data?.detail || err.message
      } finally {
        loading = null
      }
    })()
    return loading
  }

  function apply(event) {
    if (!event || event.type === 'noop' || event.doc !== key) return
    if (event.type === 'gone') {
      status.value = 'gone'
      return
    }
    if (event.reset) {
      load()
      return
    }
    if (!doc.value || loading) {
      early.push(event)
      return
    }
    if (event.rev <= doc.value.rev) return // already seen
    if (event.rev !== doc.value.rev + 1) {
      load() // one was missed: start again from the server's copy
      return
    }
    applyEvent(doc.value, event)
  }

  /** Waits for a command's event and applies it. */
  async function commit(command) {
    const event = await command
    // A command's reply doesn't name the document when it comes over HTTP.
    apply({ doc: key, ...event })
    return event
  }

  function acquire() {
    users += 1
    if (users === 1) {
      stopListening = listenToSync({ onEvent: apply, onOpen: () => { if (doc.value) load() } })
      load()
    }
  }

  function release() {
    users -= 1
    if (users === 0) {
      stopListening()
      entries.delete(key)
    }
  }

  return { doc, status, error, load, apply, commit, acquire, release }
}

/**
 * `kind` and `id` are the document's reference on the server ("encounter",
 * "fight"; "characters", "all"). `fetchDoc` loads it (`() => api.fetch(id)`).
 * The returned `doc` is null until `status` is 'ready'.
 */
export function useSyncedDoc(kind, id, fetchDoc) {
  const entry = acquireEntry(kind, id, fetchDoc)
  onBeforeUnmount(() => entry.release())
  return { doc: entry.doc, status: entry.status, error: entry.error, reload: entry.load, commit: entry.commit }
}

function acquireEntry(kind, id, fetchDoc) {
  const key = `${kind}:${id}`
  let entry = entries.get(key)
  if (!entry) {
    entry = createEntry(key, fetchDoc)
    entries.set(key, entry)
  }
  entry.acquire()
  return entry
}

/**
 * The same, for a document that may change or not exist: `id` is a function
 * (it can read a prop or another document) returning the id to follow, or
 * nothing. When it changes, the old document is let go of and the new one
 * followed. `doc` is null while there is nothing to follow, or it is loading.
 * `fetchFor(id)` loads a document.
 */
export function useSyncedDocFollowing(kind, id, fetchFor) {
  const entry = shallowRef(null)
  let held = null

  watch(id, (wanted) => {
    // The new one first: letting go of the old one first could close the
    // connection only to open it again.
    const next = wanted ? acquireEntry(kind, wanted, () => fetchFor(wanted)) : null
    held?.release()
    held = next
    entry.value = next
  }, { immediate: true })

  onBeforeUnmount(() => held?.release())

  return {
    doc: computed(() => entry.value?.doc.value ?? null),
    status: computed(() => entry.value?.status.value ?? 'idle')
  }
}

/**
 * Several documents of one kind, followed together: `ids` is a function
 * returning the ids to follow right now (an encounter's characters), and as it
 * changes new ones are followed and the ones no longer asked for let go of.
 * `docs` maps each id to its document (missing while it loads, or if there is
 * none); `statusOf(id)` says which. `fetchFor(id)` loads one.
 */
export function useSyncedDocs(kind, ids, fetchFor) {
  const held = shallowRef(new Map()) // id -> entry

  watch(() => [...new Set((ids() || []).filter(Boolean))].sort().join('\n'), (key) => {
    const wanted = key ? key.split('\n') : []
    const next = new Map()
    for (const id of wanted) next.set(id, held.value.get(id) || acquireEntry(kind, id, () => fetchFor(id)))
    for (const [id, entry] of held.value) if (!next.has(id)) entry.release()
    held.value = next
  }, { immediate: true })

  onBeforeUnmount(() => held.value.forEach((entry) => entry.release()))

  const docs = computed(() => {
    const found = {}
    for (const [id, entry] of held.value) if (entry.doc.value) found[id] = entry.doc.value
    return found
  })

  return {
    docs,
    statusOf: (id) => held.value.get(id)?.status.value ?? 'idle',
    /** Loads it again (it may have just been made), if it is followed. */
    reload: (id) => held.value.get(id)?.load(),
    /** Runs a command on one of them and applies the event it returns. */
    commit: (id, command) => (held.value.get(id)?.commit(command) ?? command)
  }
}
