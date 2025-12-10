/**
 * Cache Manager - Simple in-memory cache con TTL (Time To Live)
 * Reduce solicitudes HTTP redundantes con caché inteligente
 */

class CacheManager {
  constructor(ttlSeconds = 300) {
    this.cache = new Map()
    this.ttl = ttlSeconds * 1000 // Convertir a milisegundos
  }

  /**
   * Guardar un valor en caché
   * @param {string} key - Identificador único del caché
   * @param {any} value - Valor a guardar
   */
  set(key, value) {
    this.cache.set(key, {
      value,
      expireAt: Date.now() + this.ttl
    })
  }

  /**
   * Obtener un valor del caché
   * @param {string} key - Identificador único del caché
   * @returns {any|null} - El valor cacheado o null si expiró
   */
  get(key) {
    const item = this.cache.get(key)
    if (!item) return null

    // Verificar si el caché expiró
    if (Date.now() > item.expireAt) {
      this.cache.delete(key)
      return null
    }

    return item.value
  }

  /**
   * Limpiar todo el caché
   */
  clear() {
    this.cache.clear()
  }

  /**
   * Invalidar entradas que matcheen un patrón
   * @param {string} pattern - Patrón para buscar en las keys
   */
  invalidate(pattern) {
    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) {
        this.cache.delete(key)
      }
    }
  }

  /**
   * Obtener stats del caché (útil para debugging)
   * @returns {object} - Información sobre el caché
   */
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

// Instancia global - compartida entre todos los componentes
export const apiCache = new CacheManager(5 * 60) // 5 minutos TTL por defecto

/**
 * Helper para realizar requests con caché automático
 * @param {string} key - Identificador único del caché
 * @param {Function} fetchFn - Función que realiza el fetch
 * @returns {Promise<any>} - El resultado cacheado o nuevo
 */
export async function cachedFetch(key, fetchFn) {
  // Intentar obtener del caché primero
  const cached = apiCache.get(key)
  if (cached) {
    console.debug(`[Cache HIT] ${key}`)
    return cached
  }

  // Si no está en caché, ejecutar la función fetch
  console.debug(`[Cache MISS] ${key}`)
  const result = await fetchFn()
  
  // Guardar el resultado en caché
  apiCache.set(key, result)
  return result
}

/**
 * Helper para invalidar caché en la clase de recurso
 * @param {string} resourceType - Tipo de recurso (ej: 'note', 'graph')
 */
export function invalidateCacheByResource(resourceType) {
  apiCache.invalidate(resourceType)
  console.debug(`[Cache INVALIDATED] Patrón: ${resourceType}`)
}

export default apiCache
