import { ref } from 'vue'
import * as vistasApi from '@/api/vistas'

export function useVistas() {
  const vistas = ref([])
  const loading = ref(false)
  const error = ref(null)

  const fetchVistas = async () => {
    loading.value = true
    error.value = null
    try {
      vistas.value = await vistasApi.fetchVistas()
    } catch (err) {
      error.value = err.response?.data?.detail || err.message
    } finally {
      loading.value = false
    }
  }

  const createVista = async (name, description) => {
    const vista = await vistasApi.createVista(name, description)
    vistas.value.push(vista)
    return vista
  }

  const removeVista = async (vistaId) => {
    await vistasApi.deleteVista(vistaId)
    vistas.value = vistas.value.filter(v => v.id !== vistaId)
  }

  return { vistas, loading, error, fetchVistas, createVista, removeVista }
}
