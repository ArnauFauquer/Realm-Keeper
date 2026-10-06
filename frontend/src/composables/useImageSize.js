import { ref, watch } from 'vue'
import { resolveUrl } from '@/utils/resolveUrl'

/**
 * The natural size of the image at `url()` (an app URL, resolved here), for
 * canvases that draw over an image: `width` and `height` (0 until known) and
 * `status`: 'idle' (no image), 'loading', 'ready' or 'error' (it couldn't be
 * loaded: deleted, or not an image), so a canvas can say so rather than stay
 * blank. When the URL changes while one is loading, the older answer is
 * ignored, whichever arrives last.
 */
export function useImageSize(url) {
  const width = ref(0)
  const height = ref(0)
  const status = ref('idle')
  let current = null

  watch(url, (value) => {
    width.value = 0
    height.value = 0
    if (current) current.onload = current.onerror = null
    current = null
    if (!value) {
      status.value = 'idle'
      return
    }
    status.value = 'loading'
    const img = new Image()
    current = img
    img.onload = () => {
      if (current !== img) return
      width.value = img.naturalWidth
      height.value = img.naturalHeight
      status.value = img.naturalWidth && img.naturalHeight ? 'ready' : 'error'
    }
    img.onerror = () => {
      if (current === img) status.value = 'error'
    }
    img.src = resolveUrl(value)
  }, { immediate: true })

  return { width, height, status }
}
