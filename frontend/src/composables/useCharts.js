import { ref } from 'vue'
import * as chartsApi from '@/api/charts'

export function useCharts() {
  const folders = ref([])
  const charts = ref([])
  const loading = ref(false)
  const error = ref(null)

  const fetchTree = async (path = '') => {
    loading.value = true
    error.value = null
    try {
      const data = await chartsApi.fetchChartTree(path)
      folders.value = data.folders
      charts.value = data.charts
    } catch (err) {
      error.value = err.response?.data?.detail || err.message
    } finally {
      loading.value = false
    }
  }

  const createChart = async (name, description, folderPath = '') => {
    return chartsApi.createChart(name, description, folderPath)
  }

  const removeChart = async (path, chartId) => {
    await chartsApi.deleteChart(chartId)
    await fetchTree(path)
  }

  const createFolder = async (path, name) => {
    const newPath = path ? `${path}/${name}` : name
    await chartsApi.createChartFolder(newPath)
    await fetchTree(path)
  }

  const removeFolder = async (path, folderPath) => {
    await chartsApi.deleteChartFolder(folderPath)
    await fetchTree(path)
  }

  const moveFolder = async (path, folderPath, destParentPath) => {
    await chartsApi.moveChartFolder(folderPath, destParentPath)
    await fetchTree(path)
  }

  const moveChart = async (path, chartId, destFolderPath) => {
    await chartsApi.moveChart(chartId, destFolderPath)
    await fetchTree(path)
  }

  return {
    folders, charts, loading, error,
    fetchTree, createChart, removeChart, moveChart,
    createFolder, removeFolder, moveFolder
  }
}
