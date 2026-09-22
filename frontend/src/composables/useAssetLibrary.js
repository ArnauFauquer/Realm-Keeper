import { ref } from 'vue'
import * as libraryApi from '@/api/assetLibrary'

// Module-level (singleton): every open VistaCanvas shares one cache per
// folder path instead of each re-fetching it, and a new asset uploaded from
// one scene shows up immediately when picking in another.
const cache = new Map()

export function useAssetLibrary() {
  const folders = ref([])
  const assets = ref([])
  const loading = ref(false)
  const error = ref(null)

  const fetchPath = async (path = '', force = false) => {
    if (!force && cache.has(path)) {
      const cached = cache.get(path)
      folders.value = cached.folders
      assets.value = cached.assets
      return
    }
    loading.value = true
    error.value = null
    try {
      const data = await libraryApi.fetchLibraryContents(path)
      folders.value = data.folders
      assets.value = data.assets
      cache.set(path, data)
    } catch (err) {
      error.value = err.response?.data?.detail || err.message
    } finally {
      loading.value = false
    }
  }

  const uploadAsset = async (path, file) => {
    const result = await libraryApi.uploadLibraryAsset(path, file)
    await fetchPath(path, true)
    return result
  }

  // Uploads sequentially (rather than Promise.all) so a slow/failing upload
  // doesn't race the others for the same folder's cache entry.
  const uploadAssets = async (path, files) => {
    const results = []
    for (const file of files) {
      results.push(await libraryApi.uploadLibraryAsset(path, file))
    }
    await fetchPath(path, true)
    return results
  }

  const removeAsset = async (path, key) => {
    await libraryApi.deleteLibraryAsset(key)
    await fetchPath(path, true)
  }

  const moveAsset = async (path, key, destFolderPath) => {
    await libraryApi.moveLibraryAsset(key, destFolderPath)
    await fetchPath(path, true)
  }

  const createFolder = async (path, name) => {
    const newPath = path ? `${path}/${name}` : name
    await libraryApi.createLibraryFolder(newPath)
    await fetchPath(path, true)
  }

  const removeFolder = async (path, folderPath) => {
    await libraryApi.deleteLibraryFolder(folderPath)
    await fetchPath(path, true)
  }

  const renameFolder = async (path, folderPath, name) => {
    await libraryApi.renameLibraryFolder(folderPath, name)
    await fetchPath(path, true)
  }

  const moveFolder = async (path, folderPath, destParentPath) => {
    await libraryApi.moveLibraryFolder(folderPath, destParentPath)
    await fetchPath(path, true)
  }

  return {
    folders, assets, loading, error,
    fetchPath, uploadAsset, uploadAssets, removeAsset, moveAsset,
    createFolder, removeFolder, renameFolder, moveFolder
  }
}
