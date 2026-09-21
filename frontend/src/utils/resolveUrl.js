import { apiUrl } from '@/config/env'

// Backend-relative asset URLs (vista backgrounds, chart images, library
// assets, ...) come back as paths like "/api/vistas/assets/...". Absolute
// URLs (e.g. an external image) are left untouched.
export function resolveUrl(url) {
  if (!url) return url
  return url.startsWith('http') ? url : `${apiUrl}${url}`
}
