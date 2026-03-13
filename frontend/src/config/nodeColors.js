const COLOR_PALETTE = [
  '#e74c3c',
  '#3498db',
  '#2ecc71',
  '#f39c12',
  '#9b59b6',
  '#1abc9c',
  '#e67e22',
  '#34495e',
  '#16a085',
  '#c0392b',
  '#2980b9',
  '#27ae60',
  '#8e44ad',
  '#d35400',
  '#7f8c8d',
]

export const DEFAULT_NODE_COLOR = '#95a5a6'

const typeColorCache = new Map()

function hashString(str) {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return Math.abs(hash)
}

export function getColorForType(type) {
  if (!type) return DEFAULT_NODE_COLOR
  
  const normalizedType = type.toLowerCase().trim()
  
  if (typeColorCache.has(normalizedType)) {
    return typeColorCache.get(normalizedType)
  }
  
  const hash = hashString(normalizedType)
  const colorIndex = hash % COLOR_PALETTE.length
  const color = COLOR_PALETTE[colorIndex]
  
  typeColorCache.set(normalizedType, color)
  
  return color
}

export function getNodeColor(node) {
  if (node.type) {
    return getColorForType(node.type)
  }
  
  if (node.tags && node.tags.length > 0) {
    return getColorForType(node.tags[0])
  }
  
  return DEFAULT_NODE_COLOR
}
