/**
 * Shared building blocks for the two D3 "constellation" graph views
 * (GraphModal's full graph and RightSidebar's mini graph). Only the parts
 * that were byte-identical in both components live here — node/link visual
 * styling (hub vs. current-note treatment, colors, opacities) differs
 * enough between the two that it stays local to each component.
 */

export function drawStarfield(canvas, width, height, { density, sizeRanges, opacityRange, hueRange = [210, 260] }) {
  if (!canvas) return
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  const rand = (min, max) => min + Math.random() * (max - min)
  const starCount = Math.floor((width * height) / density)

  for (let i = 0; i < starCount; i++) {
    const x = rand(0, width)
    const y = rand(0, height)
    const r = Math.random()
    const size = r < 0.7
      ? rand(...sizeRanges[0])
      : r < 0.9
        ? rand(...sizeRanges[1])
        : rand(...sizeRanges[2])
    const opacity = rand(...opacityRange)
    const hue = rand(...hueRange)
    ctx.beginPath()
    ctx.arc(x, y, size, 0, Math.PI * 2)
    ctx.fillStyle = `hsla(${hue}, 60%, 90%, ${opacity})`
    ctx.fill()
  }
}

export function getLinkEndpointId(endpoint) {
  return typeof endpoint === 'object' ? endpoint.id : endpoint
}

export function computeDegrees(nodes, links) {
  const degrees = {}
  nodes.forEach(node => { degrees[node.id] = 0 })
  links.forEach(link => {
    const sourceId = getLinkEndpointId(link.source)
    const targetId = getLinkEndpointId(link.target)
    if (degrees[sourceId] !== undefined) degrees[sourceId]++
    if (degrees[targetId] !== undefined) degrees[targetId]++
  })
  const maxDegree = Math.max(1, ...Object.values(degrees))
  return { degrees, maxDegree }
}

export function createDragHandlers(getSimulation) {
  return {
    dragStarted(event, d) {
      if (!event.active) getSimulation().alphaTarget(0.3).restart()
      d.fx = d.x
      d.fy = d.y
    },
    dragged(event, d) {
      d.fx = event.x
      d.fy = event.y
    },
    dragEnded(event, d) {
      if (!event.active) getSimulation().alphaTarget(0)
      d.fx = null
      d.fy = null
    }
  }
}
