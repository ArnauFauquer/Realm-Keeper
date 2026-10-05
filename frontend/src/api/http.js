import axios from 'axios'
import { apiCache } from './cache'
import { useAuth } from '@/composables/useAuth'

// The one HTTP client of the app: every module in api/ goes through it, so
// they all send the session cookie, give up after 30 s, log server errors,
// and — the reason there is only one — notice when the session has expired:
// a 401 from anywhere (the Observatory, an editor, the player) signs the page
// out, instead of only from the few calls that used to go through here.
// (No Content-Type of its own: axios gives a JSON body its type, and an upload
// — FormData — must keep the one the browser gives it, with its boundary.)
export const httpClient = axios.create({
  timeout: 30000,
  withCredentials: true
})

httpClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status >= 500) {
      console.warn(`[API Error] ${error.config.method.toUpperCase()} ${error.config.url}:`, error.message)
    }
    if (error.response && error.response.status === 401) {
      useAuth().user.value = null
    }
    return Promise.reject(error)
  }
)

// A request's place in the cache: its URL with its query, so page 2 of a
// listing (`params: { offset: 500 }`) is never answered with page 1.
const cacheKey = (url, params) => `GET:${httpClient.getUri({ url, params })}`

/**
 * GET, answered from memory when the same request (URL and `params`) was made
 * less than `cacheTtl` seconds ago. `useCache: false` always asks the server
 * (and keeps nothing). Anything else is passed to axios.
 */
export async function getCached(url, options = {}) {
  const {
    useCache = true,
    cacheTtl = 300,
    ...axiosConfig
  } = options

  if (!useCache) {
    return httpClient.get(url, axiosConfig).then(res => res.data)
  }

  const key = cacheKey(url, axiosConfig.params)
  const cachedData = apiCache.get(key)
  if (cachedData) {
    return cachedData
  }

  const response = await httpClient.get(url, axiosConfig)
  const data = response.data

  if (cacheTtl && cacheTtl > 0) {
    apiCache.set(key, data, cacheTtl)
  }

  return data
}

export async function post(url, data, options = {}) {
  const response = await httpClient.post(url, data, options)
  return response.data
}

export async function put(url, data, options = {}) {
  const response = await httpClient.put(url, data, options)
  return response.data
}

/**
 * Forgets what getCached kept for this URL: with `params`, that one request;
 * without, every request to it, whatever its query (every page of a listing).
 */
export function invalidateCached(url, params) {
  if (params) {
    apiCache.delete(cacheKey(url, params))
    return
  }
  const key = cacheKey(url)
  apiCache.deleteWhere((cached) => cached === key || cached.startsWith(`${key}?`))
}
