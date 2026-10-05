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
    if (error.response && error.response.status === 401) {
      useAuth().user.value = null
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
    return cachedData
  }

  const response = await httpClient.get(url, axiosConfig)
  const data = response.data

  if (cacheTtl && cacheTtl > 0) {
    apiCache.set(cacheKey, data)
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

export function invalidateCached(url) {
  apiCache.delete(`GET:${url}`)
}
