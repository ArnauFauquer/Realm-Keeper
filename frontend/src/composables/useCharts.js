import { ref } from 'vue'
import * as chartsApi from '@/api/charts'

export function useCharts() {
  const charts = ref([])
  const loading = ref(false)
  const error = ref(null)

  const fetchCharts = async () => {
    loading.value = true
    error.value = null
    try {
      charts.value = await chartsApi.fetchCharts()
    } catch (err) {
      error.value = err.response?.data?.detail || err.message
    } finally {
      loading.value = false
    }
  }

  const createChart = async (name, description) => {
    const chart = await chartsApi.createChart(name, description)
    charts.value.push(chart)
    return chart
  }

  const removeChart = async (chartId) => {
    await chartsApi.deleteChart(chartId)
    charts.value = charts.value.filter(c => c.id !== chartId)
  }

  return { charts, loading, error, fetchCharts, createChart, removeChart }
}
