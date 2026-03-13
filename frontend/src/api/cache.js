class CacheManager {
  constructor(ttlSeconds = 300) {
    this.cache = new Map()
    this.ttl = ttlSeconds * 1000
  }

  set(key, value) {
    this.cache.set(key, {
      value,
      expireAt: Date.now() + this.ttl
    })
  }

  get(key) {
    const item = this.cache.get(key)
    if (!item) return null

    if (Date.now() > item.expireAt) {
      this.cache.delete(key)
      return null
    }

    return item.value
  }

  clear() {
    this.cache.clear()
  }

  invalidate(pattern) {
    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) {
        this.cache.delete(key)
      }
    }
  }

  getStats() {
    let validItems = 0
    let expiredItems = 0
    
    for (const item of this.cache.values()) {
      if (Date.now() > item.expireAt) {
        expiredItems++
      } else {
        validItems++
      }
    }

    return {
      total: this.cache.size,
      valid: validItems,
      expired: expiredItems,
      ttlSeconds: this.ttl / 1000
    }
  }
}

export const apiCache = new CacheManager(5 * 60)

export async function cachedFetch(key, fetchFn) {
  const cached = apiCache.get(key)
  if (cached) {
    console.debug(`[Cache HIT] ${key}`)
    return cached
  }

  console.debug(`[Cache MISS] ${key}`)
  const result = await fetchFn()
  
  apiCache.set(key, result)
  return result
}

export function invalidateCacheByResource(resourceType) {
  apiCache.invalidate(resourceType)
  console.debug(`[Cache INVALIDATED] Patrón: ${resourceType}`)
}

export default apiCache
