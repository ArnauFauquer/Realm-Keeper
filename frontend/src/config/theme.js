export const theme = {
  bg: {
    primary: '#0c0d1d',
    secondary: '#12132a',
    tertiary: '#1a1b3a',
    elevated: '#1f2045'
  },
  text: {
    primary: '#f0f0ff',
    secondary: '#a8a8c8',
    tertiary: '#6b6b8d'
  },
  border: {
    light: 'rgba(138, 43, 226, 0.2)',
    medium: 'rgba(138, 43, 226, 0.35)'
  },
  interactive: {
    primary: '#8a5cf5',
    primaryHover: '#a78bfa',
    secondary: 'rgba(138, 43, 226, 0.15)'
  },
  graph: {
    background: 'transparent',
    link: 'rgba(138, 43, 226, 0.5)',
    linkOpacity: 0.6,
    panelBg: 'rgba(12, 13, 29, 0.9)',
    panelBorder: 'rgba(138, 43, 226, 0.3)'
  }
}

export function applyTheme() {
  const root = document.documentElement
  
  Object.entries(theme).forEach(([category, values]) => {
    if (typeof values === 'object') {
      Object.entries(values).forEach(([key, value]) => {
        root.style.setProperty(`--${category}-${key}`, value)
      })
    }
  })
  
  document.body.classList.add('nebula-theme')
}

