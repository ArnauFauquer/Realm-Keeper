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
}

export const apiCache = new CacheManager(5 * 60)

