import { ref } from 'vue'

/**
 * The folders and documents of one kind, as a gallery shows them: one level
 * of the tree at a time, and the changes that rearrange it. `api` is a
 * createDocApi(...) client. Every change reloads the level it happened in.
 */
export function useDocCollection(api) {
  const folders = ref([])
  const items = ref([])
  const loading = ref(false)
  const error = ref(null)

  const fetchTree = async (path = '') => {
    loading.value = true
    error.value = null
    try {
      const data = await api.fetchTree(path)
      folders.value = data.folders
      items.value = data[api.itemsKey]
    } catch (err) {
      error.value = err.response?.data?.detail || err.message
    } finally {
      loading.value = false
    }
  }

  const create = (name, description, folderPath = '') => api.create(name, description, folderPath)

  // Each of these changes something in `path` (the level on screen), then shows it again.
  const changing = (change) => async (path, ...args) => {
    await change(...args)
    await fetchTree(path)
  }

  const joined = (path, name) => (path ? `${path}/${name}` : name)

  return {
    folders, items, loading, error,
    fetchTree, create,
    remove: changing((id) => api.remove(id)),
    move: changing((id, destFolderPath) => api.move(id, destFolderPath)),
    rename: changing((id, name) => api.rename(id, name)),
    createFolder: async (path, name) => {
      await api.createFolder(joined(path, name))
      await fetchTree(path)
    },
    removeFolder: changing((folderPath) => api.removeFolder(folderPath)),
    renameFolder: changing((folderPath, name) => api.renameFolder(folderPath, name)),
    moveFolder: changing((folderPath, destParentPath) => api.moveFolder(folderPath, destParentPath))
  }
}
