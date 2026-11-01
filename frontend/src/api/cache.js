// Responses kept in memory for a while (api/http.js getCached), each for as
// long as whoever stored it asked. An expired entry is dropped when it is
// read, and every other expired one each time something new is stored, so
// pages visited once don't stay in memory for the whole session.
class CacheManager {
  constructor(ttlSeconds = 300) {
    this.cache = new Map()
    this.ttl = ttlSeconds * 1000
  }

  set(key, value, ttlSeconds) {
    this.evictExpired()
    const ttl = ttlSeconds === undefined ? this.ttl : ttlSeconds * 1000
    this.cache.set(key, {
      value,
      expireAt: Date.now() + ttl
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

  evictExpired() {
    const now = Date.now()
    for (const [key, item] of this.cache) {
      if (now > item.expireAt) this.cache.delete(key)
    }
  }

  delete(key) {
    this.cache.delete(key)
  }

  /** Drops every entry whose key `matches(key)`. */
  deleteWhere(matches) {
    for (const key of [...this.cache.keys()]) {
      if (matches(key)) this.cache.delete(key)
    }
  }

  clear() {
    this.cache.clear()
  }

  get size() {
    return this.cache.size
  }
}

export const apiCache = new CacheManager(5 * 60)
