import { ref } from 'vue'
import * as libraryApi from '@/api/assetLibrary'

// Module-level (singleton): every open VistaCanvas shares one fetch of the
// library instead of each re-fetching it, and a new asset uploaded from one
// scene shows up immediately when picking in another.
const assets = ref([])
const folders = ref([])
const loading = ref(false)
const error = ref(null)
let assetsFetched = false
let foldersFetched = false

export function useAssetLibrary() {
  const fetchLibrary = async (force = false) => {
    if (assetsFetched && !force) return
    loading.value = true
    error.value = null
    try {
      assets.value = await libraryApi.fetchLibraryAssets()
      assetsFetched = true
    } catch (err) {
      error.value = err.response?.data?.detail || err.message
    } finally {
      loading.value = false
    }
  }

  const fetchFolders = async (force = false) => {
    if (foldersFetched && !force) return
    try {
      folders.value = await libraryApi.fetchLibraryFolders()
      foldersFetched = true
    } catch (err) {
      error.value = err.response?.data?.detail || err.message
    }
  }

  const createLibraryAsset = async (name, file, folderId = null) => {
    const item = await libraryApi.createLibraryAsset(name, folderId)
    const updated = await libraryApi.uploadLibraryAssetImage(item.id, file)
    assets.value.push(updated)
    return updated
  }

  const removeLibraryAsset = async (itemId) => {
    await libraryApi.deleteLibraryAsset(itemId)
    assets.value = assets.value.filter(a => a.id !== itemId)
  }

  const createLibraryFolder = async (name, parentId = null) => {
    const folder = await libraryApi.createLibraryFolder(name, parentId)
    folders.value.push(folder)
    return folder
  }

  const removeLibraryFolder = async (folderId) => {
    await libraryApi.deleteLibraryFolder(folderId)
    // Cascades server-side (nested folders + their assets); simplest to
    // just re-fetch both lists rather than recompute what else vanished.
    await Promise.all([fetchFolders(true), fetchLibrary(true)])
  }

  return {
    assets, folders, loading, error,
    fetchLibrary, fetchFolders,
    createLibraryAsset, removeLibraryAsset,
    createLibraryFolder, removeLibraryFolder
  }
}
