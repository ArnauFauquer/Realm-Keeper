import axios from 'axios'
import { apiCache, invalidateCacheByResource } from './cache'

const httpClient = axios.create({
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json'
  }
})

httpClient.interceptors.request.use((config) => {
  if (config.method === 'get') {
    config.headers['Cache-Control'] = 'max-age=300'
  } else {
    config.headers['Cache-Control'] = 'no-cache'
  }
  return config
})

httpClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status >= 500) {
      console.warn(`[API Error] ${error.config.method.toUpperCase()} ${error.config.url}:`, error.message)
    }
    return Promise.reject(error)
  }
)

export async function getCached(url, options = {}) {
  const {
    useCache = true,
    cacheTtl = 300,
    ...axiosConfig
  } = options

  const cacheKey = `GET:${url}`

  if (!useCache) {
    return httpClient.get(url, axiosConfig).then(res => res.data)
  }

  const cachedData = apiCache.get(cacheKey)
  if (cachedData) {
    console.debug(`[Cache HIT] ${url}`)
    return cachedData
  }

  console.debug(`[Cache MISS] ${url}`)
  const response = await httpClient.get(url, axiosConfig)
  const data = response.data

  if (cacheTtl && cacheTtl > 0) {
    apiCache.set(cacheKey, data)
  }

  return data
}

export async function postWithCache(url, data, options = {}) {
  const { invalidatePattern, ...axiosConfig } = options
  
  const response = await httpClient.post(url, data, axiosConfig)
  
  if (invalidatePattern) {
    invalidateCacheByResource(invalidatePattern)
    console.debug(`[Cache INVALIDATED] Patrón: ${invalidatePattern}`)
  }

  return response.data
}

export async function putWithCache(url, data, options = {}) {
  const { invalidatePattern, ...axiosConfig } = options
  
  const response = await httpClient.put(url, data, axiosConfig)
  
  if (invalidatePattern) {
    invalidateCacheByResource(invalidatePattern)
  }

  return response.data
}

export async function deleteWithCache(url, options = {}) {
  const { invalidatePattern, ...axiosConfig } = options
  
  const response = await httpClient.delete(url, axiosConfig)
  
  if (invalidatePattern) {
    invalidateCacheByResource(invalidatePattern)
  }

  return response.data
}

export async function getNoCache(url, options = {}) {
  return getCached(url, { ...options, useCache: false })
}

export async function getStream(url, onChunk, options = {}) {
  const { ...axiosConfig } = options

  return httpClient.get(url, {
    ...axiosConfig,
    responseType: 'stream',
    onDownloadProgress: (progressEvent) => {
      const chunk = new TextDecoder().decode(progressEvent.event.target.response)
      onChunk(chunk)
    }
  }).then(res => res.data)
}

export function clearAllCache() {
  apiCache.clear()
  console.debug('[Cache CLEARED] Todo el cache fue limpiado')
}

export function getCacheStats() {
  return apiCache.getStats()
}

export default {
  getCached,
  postWithCache,
  putWithCache,
  deleteWithCache,
  getNoCache,
  getStream,
  clearAllCache,
  getCacheStats,
  httpClient
}
