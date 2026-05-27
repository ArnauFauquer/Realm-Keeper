<template>
  <div class="screen-root" @keydown.esc="close" tabindex="0" ref="root">
    <!-- Star constellation background -->
    <canvas ref="starCanvas" class="star-canvas"></canvas>
    <!-- Ambient glow behind image -->
    <div class="ambient-glow" :style="glowStyle"></div>

    <!-- Media area -->
    <div class="screen-media-area">
      <!-- 1. Waiting for first media -->
      <div v-if="!displayUrl && !error" class="screen-loading">
        <div class="loading-spinner"></div>
        <p>Waiting for media…</p>
      </div>

      <!-- 2. Loading spinner while media is fetching -->
      <div v-else-if="loading && !error" class="screen-loading">
        <div class="loading-spinner"></div>
        <p v-if="displayTitle" class="loading-text">Loading {{ displayTitle }}…</p>
      </div>

      <!-- 3. Error state -->
      <div v-else-if="error" class="screen-error">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <p>Could not load media</p>
        <small>{{ displayUrl }}</small>
        <button @click="retry" class="retry-btn">Retry</button>
      </div>

      <!-- 4. The actual media (rendered even if loading to trigger @load) -->
      <img
        v-if="displayUrl && isImage"
        v-show="!loading && !error"
        :src="displayUrl"
        :key="displayUrl"
        :alt="displayTitle"
        class="screen-image-fill"
        @load="onMediaLoad"
        @error="onMediaError"
        draggable="false"
      />
    </div>

    <!-- Minimal Title Overlay (Optional, user said remove buttons, but title might be nice. 
         Wait, user said "remove all buttons", didn't explicitly say remove title. 
         But "Immersive" usually means no text either. I'll keep it very subtle or remove it if it feels cluttered.
         I'll keep a very subtle title that fades out.) -->
    <div class="screen-caption" :class="{ hidden: !showTitle }" v-if="displayTitle">
      {{ displayTitle }}
    </div>
  </div>
</template>

<script>
export default {
  name: 'ScreenView',
  data() {
    return {
      loading: true,
      error: false,
      displayUrl: '',
      displayTitle: '',
      showTitle: false,
      titleTimer: null,
      ws: null,
      dominantColor: null,
    }
  },
  computed: {
    apiUrl() {
      return import.meta.env.VITE_API_URL || ''
    },
    isImage() {
      if (!this.displayUrl) return false
      const url = this.displayUrl.toLowerCase()
      return /\.(png|jpe?g|gif|webp|svg|avif|bmp|tiff?)(\?.*)?$/.test(url) || !this.displayUrl.match(/\.(mp4|webm|ogg|mp3|wav|flac)(\?.*)?$/)
    },
    glowStyle() {
      if (this.dominantColor) {
        return { background: `radial-gradient(ellipse at center, ${this.dominantColor}40 0%, transparent 70%)` }
      }
      return { background: 'radial-gradient(ellipse at center, rgba(138, 92, 245, 0.2) 0%, transparent 70%)' }
    }
  },
  methods: {
    drawStarfield() {
      const canvas = this.$refs.starCanvas
      if (!canvas) return
      const w = window.innerWidth
      const h = window.innerHeight
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      const rand = (a, b) => a + Math.random() * (b - a)
      const count = Math.floor((w * h) / 3500)
      for (let i = 0; i < count; i++) {
        const r = Math.random()
        const size = r < 0.65 ? rand(0.3, 0.9) : r < 0.88 ? rand(0.9, 1.6) : rand(1.6, 2.8)
        const opacity = rand(0.12, 0.55)
        const hue = rand(210, 265)
        ctx.beginPath()
        ctx.arc(rand(0, w), rand(0, h), size, 0, Math.PI * 2)
        ctx.fillStyle = `hsla(${hue}, 55%, 92%, ${opacity})`
        ctx.fill()
      }
    },
    close() {
      // Allow exiting fullscreen mode
      if (window.history.length > 1) {
        this.$router.go(-1)
      } else {
        this.$router.push('/')
      }
    },
    onMediaLoad() {
      this.loading = false
      this.error = false
      this.triggerTitle()
    },
    onMediaError() {
      this.loading = false
      this.error = true
    },
    retry() {
      this.error = false
      this.loading = true
      // Force reload by slightly modifying the URL or just letting Vue re-render
      const url = this.displayUrl
      this.displayUrl = ''
      this.$nextTick(() => {
        this.displayUrl = url
      })
    },
    triggerTitle() {
      this.showTitle = true
      clearTimeout(this.titleTimer)
      this.titleTimer = setTimeout(() => {
        this.showTitle = false
      }, 5000)
    },
    connectWebSocket() {
      if (this.ws) {
        this.ws.close()
      }

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      
      // Improve host detection:
      // 1. Use the host from VITE_API_URL if it's set
      // 2. Otherwise, use the current window host (assuming backend is on same host/port, or proxied)
      let host = window.location.host
      if (this.apiUrl) {
        // Strip protocol
        const apiHost = this.apiUrl.replace(/^http(s)?:\/\//, '')
        
        // If VITE_API_URL is just 'localhost:8000' but we are accessing via IP, 
        // we should try to use the current hostname but with the same port.
        if (apiHost.startsWith('localhost:') && window.location.hostname !== 'localhost') {
          const port = apiHost.split(':')[1] || '8000'
          host = `${window.location.hostname}:${port}`
        } else {
          host = apiHost
        }
      }
      
      const wsUrl = `${protocol}//${host}/ws/screen`

      console.log('Connecting to screen WebSocket:', wsUrl)
      this.ws = new WebSocket(wsUrl)

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          console.log('WS message received:', data)
          
          if (data.type === 'display_media') {
            this.updateMedia(data.url, data.title)
          } else if (data.type === 'clear_screen') {
            this.displayUrl = ''
            this.displayTitle = ''
            this.loading = false
          }
        } catch (e) {
          console.error('Error parsing WS message:', e)
        }
      }

      this.ws.onopen = () => {
        console.log('WebSocket connected successfully')
        this.error = false
      }

      this.ws.onclose = (event) => {
        console.log(`WebSocket closed (code: ${event.code}). Retrying in 3s...`)
        setTimeout(() => this.connectWebSocket(), 3000)
      }

      this.ws.onerror = (err) => {
        console.error('WebSocket error:', err)
        // onclose will handle retry
      }
    },
    updateMedia(url, title) {
      if (!url) return
      
      // Fix localhost URLs if needed
      let finalUrl = url
      if (url.includes('localhost:') && window.location.hostname !== 'localhost') {
        const parts = url.split('/')
        const hostPort = parts[2] // e.g. localhost:8000
        const port = hostPort.split(':')[1] || '8000'
        parts[2] = `${window.location.hostname}:${port}`
        finalUrl = parts.join('/')
        console.log('Rewrote URL for remote access:', finalUrl)
      }

      // If it's the same URL, don't trigger a new load (which would get stuck in the loading spinner)
      // Just update the title and trigger the overlay animation
      if (this.displayUrl === finalUrl) {
        this.displayTitle = title || ''
        this.triggerTitle()
        this.loading = false
        this.error = false
        return
      }

      this.loading = true
      this.error = false
      this.displayUrl = finalUrl
      this.displayTitle = title || ''
    }
  },
  mounted() {
    this.$refs.root?.focus()
    this.drawStarfield()

    // Check for initial data in query
    const queryUrl = this.$route.query.url
    const queryTitle = this.$route.query.title
    if (queryUrl) {
      this.updateMedia(queryUrl, queryTitle)
    } else {
      this.loading = true // Waiting for WS
    }

    this.connectWebSocket()
  },
  beforeUnmount() {
    if (this.ws) {
      this.ws.close()
    }
    clearTimeout(this.titleTimer)
  }
}
</script>

<style scoped>
.screen-root {
  position: fixed;
  inset: 0;
  background: radial-gradient(ellipse at 30% 35%, rgba(18, 10, 55, 1) 0%, rgba(5, 4, 20, 1) 45%, rgba(2, 2, 10, 1) 100%);
  display: flex;
  flex-direction: column;
  z-index: 9999;
  outline: none;
  overflow: hidden;
  cursor: none;
}

.star-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 0;
}

/* ─── Ambient glow ─── */
.ambient-glow {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  opacity: 0.5;
  transition: background 1.5s ease;
}

/* ─── Media area ─── */
.screen-media-area {
  position: relative;
  z-index: 1;
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100vw;
  height: 100vh;
}

.screen-image-fill {
  width: 100vw;
  height: 100vh;
  object-fit: contain; /* Prevent stretching while showing the entire image */
  user-select: none;
  transition: opacity 0.5s ease;
}

/* ─── Caption (Subtle overlay) ─── */
.screen-caption {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 10;
  padding: 2rem;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.8) 0%, transparent 100%);
  color: rgba(255, 255, 255, 0.9);
  font-size: 1.5rem;
  font-weight: 500;
  text-align: center;
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.8);
  transition: opacity 1s ease, transform 1s ease;
}

.screen-caption.hidden {
  opacity: 0;
  transform: translateY(20px);
}

/* ─── Loading / Waiting ─── */
.screen-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.5rem;
  color: rgba(255, 255, 255, 0.3);
  font-size: 1.2rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.loading-spinner {
  width: 60px;
  height: 60px;
  border: 4px solid rgba(138, 92, 245, 0.1);
  border-top-color: #8a5cf5;
  border-radius: 50%;
  animation: spin 1.5s cubic-bezier(0.68, -0.55, 0.27, 1.55) infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.screen-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  color: rgba(255, 100, 100, 0.5);
}

.retry-btn {
  margin-top: 1rem;
  background: rgba(255, 100, 100, 0.2);
  border: 1px solid rgba(255, 100, 100, 0.3);
  color: #ff9999;
  padding: 0.5rem 1.5rem;
  border-radius: 8px;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.2s ease;
  pointer-events: auto;
}

.retry-btn:hover {
  background: rgba(255, 100, 100, 0.4);
  color: #fff;
}

.loading-text {
  font-size: 0.9rem;
  opacity: 0.7;
}
</style>
