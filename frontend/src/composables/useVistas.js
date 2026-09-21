import { ref } from 'vue'
import * as vistasApi from '@/api/vistas'

export function useVistas() {
  const folders = ref([])
  const vistas = ref([])
  const loading = ref(false)
  const error = ref(null)

  const fetchTree = async (path = '') => {
    loading.value = true
    error.value = null
    try {
      const data = await vistasApi.fetchVistaTree(path)
      folders.value = data.folders
      vistas.value = data.vistas
    } catch (err) {
      error.value = err.response?.data?.detail || err.message
    } finally {
      loading.value = false
    }
  }

  const createVista = async (name, description, folderPath = '') => {
    return vistasApi.createVista(name, description, folderPath)
  }

  const removeVista = async (path, vistaId) => {
    await vistasApi.deleteVista(vistaId)
    await fetchTree(path)
  }

  const createFolder = async (path, name) => {
    const newPath = path ? `${path}/${name}` : name
    await vistasApi.createVistaFolder(newPath)
    await fetchTree(path)
  }

  const removeFolder = async (path, folderPath) => {
    await vistasApi.deleteVistaFolder(folderPath)
    await fetchTree(path)
  }

  const moveFolder = async (path, folderPath, destParentPath) => {
    await vistasApi.moveVistaFolder(folderPath, destParentPath)
    await fetchTree(path)
  }

  const moveVista = async (path, vistaId, destFolderPath) => {
    await vistasApi.moveVista(vistaId, destFolderPath)
    await fetchTree(path)
  }

  return {
    folders, vistas, loading, error,
    fetchTree, createVista, removeVista, moveVista,
    createFolder, removeFolder, moveFolder
  }
}
