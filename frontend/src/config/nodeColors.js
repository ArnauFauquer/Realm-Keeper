/**
 * Node color configuration for graph visualizations
 * Domain-agnostic color system that works for any wiki/vault
 */

/**
 * Color palette for dynamic type assignment
 * These colors are visually distinct and work well together
 */
const COLOR_PALETTE = [
  '#e74c3c', // Red
  '#3498db', // Blue
  '#2ecc71', // Green
  '#f39c12', // Orange
  '#9b59b6', // Purple
  '#1abc9c', // Teal
  '#e67e22', // Dark Orange
  '#34495e', // Dark Blue-Gray
  '#16a085', // Dark Teal
  '#c0392b', // Dark Red
  '#2980b9', // Dark Blue
  '#27ae60', // Dark Green
  '#8e44ad', // Dark Purple
  '#d35400', // Burnt Orange
  '#7f8c8d', // Gray
]

export const DEFAULT_NODE_COLOR = '#95a5a6'

/**
 * Cache for dynamically assigned type colors
 * Maps type names to colors from the palette
 */
const typeColorCache = new Map()

/**
 * Generate a consistent hash for a string
 * @param {string} str - The string to hash
 * @returns {number} A positive integer hash
 */
function hashString(str) {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32bit integer
  }
  return Math.abs(hash)
}

/**
 * Get color for a node based on its type
 * Dynamically assigns colors from the palette based on type name
 * @param {string} type - The node type
 * @returns {string} Hex color code
 */
export function getColorForType(type) {
  if (!type) return DEFAULT_NODE_COLOR
  
  const normalizedType = type.toLowerCase().trim()
  
  // Check cache first
  if (typeColorCache.has(normalizedType)) {
    return typeColorCache.get(normalizedType)
  }
  
  // Generate consistent color based on type name hash
  const hash = hashString(normalizedType)
  const colorIndex = hash % COLOR_PALETTE.length
  const color = COLOR_PALETTE[colorIndex]
  
  // Cache the result for consistency
  typeColorCache.set(normalizedType, color)
  
  return color
}

/**
 * Get color for a node with tag-based fallback
 * @param {Object} node - Node object with type and tags
 * @returns {string} Hex color code
 */
export function getNodeColor(node) {
  // Priority 1: Use type if available
  if (node.type) {
    return getColorForType(node.type)
  }
  
  // Priority 2: Fallback to first tag
  if (node.tags && node.tags.length > 0) {
    return getColorForType(node.tags[0])
  }
  
  // Priority 3: Default color
  return DEFAULT_NODE_COLOR
}

/**
 * Get all currently assigned type colors
 * Useful for building legends
 * @returns {Map<string, string>} Map of type names to colors
 */
export function getAssignedColors() {
  return new Map(typeColorCache)
}

/**
 * Clear the color cache (useful for testing or reset)
 */
export function clearColorCache() {
  typeColorCache.clear()
}
