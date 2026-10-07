import { watch, nextTick } from 'vue'
import * as d3 from 'd3'
import { useImageSize } from '@/composables/useImageSize'

/**
 * What a map drawn as SVG over an image needs, shared by the chart and the
 * battlemap: the image's size (the SVG's coordinates are its pixels), zoom and
 * pan of the group everything is drawn in, and turning a pointer event into a
 * point of the map.
 *
 * `svgRef` is the <svg>, `groupRef` the <g> that zooms. The options are
 * functions, so they can read props: `imageUrl()`, `zoomable()`, `canPan()`
 * (whether a drag may pan: only when it isn't doing something else) and
 * `resetKey()`, whose change puts the view back to its start (another map).
 * `imageStatus` is useImageSize's: 'error' when the image can't be loaded.
 * `fit()` and `zoomBy(factor)` are for buttons that zoom.
 */
export function useMapViewport({ svgRef, groupRef, imageUrl, zoomable = () => true, canPan = () => true, resetKey = () => null }) {
  const { width: naturalWidth, height: naturalHeight, status: imageStatus } = useImageSize(imageUrl)
  let zoomBehavior = null

  function setupZoom() {
    if (!zoomable() || !svgRef.value || !groupRef.value) return
    const group = d3.select(groupRef.value)
    zoomBehavior = d3.zoom()
      .scaleExtent([0.5, 12])
      .filter((event) => event.type === 'wheel' || (canPan() && !event.button))
      .on('zoom', (event) => { group.attr('transform', event.transform) })
    d3.select(svgRef.value).call(zoomBehavior).on('dblclick.zoom', null)
  }

  // The SVG only exists once the image has a size.
  watch(naturalWidth, async (width) => {
    if (width > 0) {
      await nextTick()
      setupZoom()
    }
  })

  /** The whole map in view again, as it opened. */
  function fit() {
    if (zoomBehavior && svgRef.value) {
      d3.select(svgRef.value).call(zoomBehavior.transform, d3.zoomIdentity)
    }
  }

  /** Closer in (`factor` > 1) or further out, about the middle of the view. */
  function zoomBy(factor) {
    if (zoomBehavior && svgRef.value) {
      d3.select(svgRef.value).call(zoomBehavior.scaleBy, factor)
    }
  }

  watch(resetKey, fit)

  /** The point of the map (in image pixels) under a pointer event, or null. */
  function pointer(event) {
    if (!groupRef.value) return null
    const [x, y] = d3.pointer(event, groupRef.value)
    return { x, y }
  }

  return { naturalWidth, naturalHeight, imageStatus, pointer, fit, zoomBy }
}
