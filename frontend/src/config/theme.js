/**
 * Nebula Dark Theme configuration
 * Fixed dark theme with purple and blue nebula colors
 */

export const theme = {
  // Base colors - Deep space dark
  bg: {
    primary: '#0c0d1d',
    secondary: '#12132a',
    tertiary: '#1a1b3a',
    elevated: '#1f2045'
  },
  text: {
    primary: '#f0f0ff',
    secondary: '#a8a8c8',
    tertiary: '#6b6b8d',
    inverse: '#0c0d1d'
  },
  border: {
    light: 'rgba(138, 43, 226, 0.2)',
    medium: 'rgba(138, 43, 226, 0.35)',
    dark: 'rgba(138, 43, 226, 0.5)'
  },
  // Interactive elements - Nebula accent colors
  interactive: {
    primary: '#8a5cf5',
    primaryHover: '#a78bfa',
    secondary: 'rgba(138, 43, 226, 0.15)',
    secondaryHover: 'rgba(138, 43, 226, 0.25)'
  },
  // Status colors - Cosmic palette
  status: {
    success: '#4ade80',
    error: '#f87171',
    warning: '#fbbf24',
    info: '#60a5fa'
  },
  // Shadows with purple glow
  shadow: {
    sm: '0 1px 2px rgba(0, 0, 0, 0.5)',
    md: '0 2px 8px rgba(75, 0, 130, 0.3)',
    lg: '0 4px 16px rgba(75, 0, 130, 0.4)'
  },
  // Nebula specific colors
  nebula: {
    purple: 'rgba(138, 43, 226, 0.15)',
    blue: 'rgba(65, 105, 225, 0.15)',
    pink: 'rgba(255, 20, 147, 0.1)',
    indigo: 'rgba(75, 0, 130, 0.2)'
  },
  // Graph specific
  graph: {
    background: 'transparent',
    link: 'rgba(138, 43, 226, 0.5)',
    linkOpacity: 0.6,
    panelBg: 'rgba(12, 13, 29, 0.9)',
    panelBorder: 'rgba(138, 43, 226, 0.3)'
  }
}

/**
 * Apply theme CSS variables to document root
 */
export function applyTheme() {
  const root = document.documentElement
  
  // Apply CSS variables
  Object.entries(theme).forEach(([category, values]) => {
    if (typeof values === 'object') {
      Object.entries(values).forEach(([key, value]) => {
        root.style.setProperty(`--${category}-${key}`, value)
      })
    }
  })
  
  // Add theme class to body
  document.body.classList.add('nebula-theme')
}
