/**
 * HTTP API Wrapper - Integra cache automático y manejo de errores
 * Reduce solicitudes redundantes con estrategias de cache inteligentes
 */

import axios from 'axios'
import { apiCache, invalidateCacheByResource } from './cache'

// Crear instancia de axios
const httpClient = axios.create({
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json'
  }
})

/**
 * Interceptor para agregar headers de Cache-Control
 */
httpClient.interceptors.request.use((config) => {
  // GET requests: permitir cache
  if (config.method === 'get') {
    config.headers['Cache-Control'] = 'max-age=300' // 5 minutos
  } else {
    // POST, PUT, DELETE: no cachear en browser
    config.headers['Cache-Control'] = 'no-cache'
  }
  return config
})

/**
 * Interceptor para manejo de errores global
 */
httpClient.interceptors.response.use(
  (response) => response,
  (error) => {
    // Intentar usar cache si la request falló
    if (error.response && error.response.status >= 500) {
      console.warn(`[API Error] ${error.config.method.toUpperCase()} ${error.config.url}:`, error.message)
    }
    return Promise.reject(error)
  }
)

/**
 * Wrapper para GET con cache automático
 * @param {string} url - URL a solicitar
 * @param {object} options - Opciones adicionales
 * @param {boolean} options.useCache - Usar cache (default: true)
 * @param {number} options.cacheTtl - TTL del cache en segundos (default: 300)
 * @returns {Promise<any>}
 */
export async function getCached(url, options = {}) {
  const {
    useCache = true,
    cacheTtl = 300,
    ...axiosConfig
  } = options

  // Generar clave de caché
  const cacheKey = `GET:${url}`

  // Si cache está deshabilitado, hacer request directo
  if (!useCache) {
    return httpClient.get(url, axiosConfig).then(res => res.data)
  }

  // Verificar cache
  const cachedData = apiCache.get(cacheKey)
  if (cachedData) {
    console.debug(`[Cache HIT] ${url}`)
    return cachedData
  }

  // Request si no está en cache
  console.debug(`[Cache MISS] ${url}`)
  const response = await httpClient.get(url, axiosConfig)
  const data = response.data

  // Guardar en cache con TTL personalizado
  if (cacheTtl && cacheTtl > 0) {
    apiCache.set(cacheKey, data)
  }

  return data
}

/**
 * POST con invalidación automática de cache
 * @param {string} url - URL a solicitar
 * @param {object} data - Datos a enviar
 * @param {object} options - Opciones adicionales
 * @param {string} options.invalidatePattern - Patrón para invalidar cache (ej: 'note:')
 * @returns {Promise<any>}
 */
export async function postWithCache(url, data, options = {}) {
  const { invalidatePattern, ...axiosConfig } = options
  
  const response = await httpClient.post(url, data, axiosConfig)
  
  // Invalidar cache si se especifica
  if (invalidatePattern) {
    invalidateCacheByResource(invalidatePattern)
    console.debug(`[Cache INVALIDATED] Patrón: ${invalidatePattern}`)
  }

  return response.data
}

/**
 * PUT con invalidación automática de cache
 */
export async function putWithCache(url, data, options = {}) {
  const { invalidatePattern, ...axiosConfig } = options
  
  const response = await httpClient.put(url, data, axiosConfig)
  
  if (invalidatePattern) {
    invalidateCacheByResource(invalidatePattern)
  }

  return response.data
}

/**
 * DELETE con invalidación automática de cache
 */
export async function deleteWithCache(url, options = {}) {
  const { invalidatePattern, ...axiosConfig } = options
  
  const response = await httpClient.delete(url, axiosConfig)
  
  if (invalidatePattern) {
    invalidateCacheByResource(invalidatePattern)
  }

  return response.data
}

/**
 * GET sin cache (para datos que cambian frecuentemente)
 */
export async function getNoCache(url, options = {}) {
  return getCached(url, { ...options, useCache: false })
}

/**
 * Streaming GET para datos grandes (ej: chat)
 * No usa cache, procesa respuesta por chunks
 */
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

/**
 * Limpiar todo el cache (ej: logout)
 */
export function clearAllCache() {
  apiCache.clear()
  console.debug('[Cache CLEARED] Todo el cache fue limpiado')
}

/**
 * Obtener estadísticas de cache
 */
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
  // Exportar cliente directo para casos especiales
  httpClient
}
