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
 * `fit()` and `zoomBy(factor)` are for buttons that zoom. `onView(rect)` is
 * told the part of the map in view (in the image's pixels, possibly beyond
 * its edges) each time it is zoomed or panned, or null when the view is back
 * where it started.
 */
export function useMapViewport({ svgRef, groupRef, imageUrl, zoomable = () => true, canPan = () => true, resetKey = () => null, onView = null }) {
  const { width: naturalWidth, height: naturalHeight, status: imageStatus } = useImageSize(imageUrl)
  let zoomBehavior = null

  function setupZoom() {
    if (!zoomable() || !svgRef.value || !groupRef.value) return
    const group = d3.select(groupRef.value)
    zoomBehavior = d3.zoom()
      .scaleExtent([0.5, 12])
      .filter((event) => event.type === 'wheel' || (canPan() && !event.button))
      .on('zoom', (event) => {
        group.attr('transform', event.transform)
        if (onView) onView(isIdentity(event.transform) ? null : visibleRect(event.transform))
      })
    d3.select(svgRef.value).call(zoomBehavior).on('dblclick.zoom', null)
  }

  // The SVG only exists once the image has a size.
  watch(naturalWidth, async (width) => {
    if (width > 0) {
      await nextTick()
      setupZoom()
    }
  })

  const isIdentity = (t) => t.k === 1 && t.x === 0 && t.y === 0

  /** The part of the map the SVG shows under the zoom `transform`, in the map's own coordinates. */
  function visibleRect(transform) {
    // The SVG's own matrix (its viewBox fitted to its box), which zooming
    // doesn't change: the group's would still be the one before this zoom.
    const ctm = svgRef.value?.getScreenCTM?.()
    if (!ctm) return null
    const inverse = ctm.inverse()
    const box = svgRef.value.getBoundingClientRect()
    const at = (x, y) => {
      const p = new DOMPoint(x, y).matrixTransform(inverse)
      return { x: (p.x - transform.x) / transform.k, y: (p.y - transform.y) / transform.k }
    }
    const from = at(box.left, box.top)
    const to = at(box.right, box.bottom)
    return { x: from.x, y: from.y, width: to.x - from.x, height: to.y - from.y }
  }

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
