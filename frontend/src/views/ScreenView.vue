<template>
  <div class="screen-root" @keydown.esc="close" tabindex="0" ref="root">
    <!-- Star constellation background -->
    <canvas ref="starCanvas" class="star-canvas"></canvas>
    <!-- Ambient glow behind image -->
    <div class="ambient-glow" :style="glowStyle"></div>

    <!-- Chart area -->
    <div v-if="activeChart" class="screen-chart-area">
      <ChartCanvas :chart="activeChart" :editable="false" :zoomable="false" />
    </div>

    <!-- Vista area -->
    <div v-else-if="activeVista" class="screen-vista-area">
      <VistaCanvas :vista="activeVista" :editable="false" />
    </div>

    <!-- Battlemap area -->
    <div v-else-if="activeBattlemap" class="screen-battlemap-area">
      <BattlemapScreen :state="activeBattlemap" />
    </div>

    <!-- Constellation area -->
    <div v-else-if="activeConstellation" class="screen-constellation-area">
      <ConstellationScreen :key="constellationKey" :state="activeConstellation" />
    </div>

    <!-- Media area -->
    <div v-else class="screen-media-area">
      <!-- 0. Not paired: the socket (and everything it would show) needs a
           screen link or a signed-in user. -->
      <div v-if="!displayUrl && notPaired" class="screen-loading screen-unpaired">
        <span class="mdi mdi-monitor-lock"></span>
        <p>{{ pairError || 'This screen isn’t paired yet.' }}</p>
        <small>Copy the screen link in Realm Keeper (sidebar → monitor icon) and open it on this device.</small>
      </div>

      <!-- 1. Waiting for first media -->
      <div v-else-if="!displayUrl && !error" class="screen-loading">
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

    <!-- Dice roll overlay - sits on top of whatever is showing above (waiting
         state or an image) without touching its state, so that content is
         still there, untouched, once the roll's display timer clears it. -->
    <div v-if="diceRoll" class="screen-dice-result" :class="diceRoll.duality && `duality--${diceRoll.duality.outcome}`" :key="diceRoll.id">
      <canvas ref="diceCanvas" class="dice-canvas"></canvas>
      <div class="dice-caption">
        <div v-if="diceRoll.label" class="dice-label">{{ diceRoll.label }}</div>
        <div class="dice-formula">{{ diceRoll.formula }}</div>
        <div class="dice-breakdown">
          <span v-for="(g, i) in diceRoll.groups" :key="i" class="dice-group">
            <span v-if="i > 0 || g.sign < 0" class="dice-sign">{{ g.sign > 0 ? '+' : '-' }}</span>
            <span v-if="g.kind" class="dice-rolls" :class="`kind--${g.kind}`">{{ g.kind === 'hope' ? 'Hope' : 'Fear' }} {{ g.rolls[0] }}</span>
            <span v-else class="dice-rolls">[<template v-for="(v, j) in g.rolls" :key="j"><template v-if="j">, </template><span :class="rollClass(g, j, diceRoll.natural) && `nat--${rollClass(g, j, diceRoll.natural)}`">{{ v }}</span></template>]</span>
          </span>
          <span v-if="diceRoll.flatModifier" class="dice-flat">
            {{ diceRoll.flatModifier > 0 ? '+' : '' }}{{ diceRoll.flatModifier }}
          </span>
        </div>
        <div class="dice-total">{{ diceRoll.total }}</div>
        <div v-if="diceRoll.duality" class="dice-outcome">{{ dualityLabels[diceRoll.duality.outcome] }}</div>
        <div v-if="diceRoll.natural?.critical" class="dice-outcome outcome--crit">{{ naturalLabels.critical }}</div>
        <div v-if="diceRoll.natural?.fumble" class="dice-outcome outcome--fumble">{{ naturalLabels.fumble }}</div>
      </div>
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
import { socketUrl } from '@/utils/socketUrl'
import ChartCanvas from '@/components/ChartCanvas.vue'
import VistaCanvas from '@/components/VistaCanvas.vue'
import ConstellationScreen from '@/components/ConstellationScreen.vue'
import BattlemapScreen from '@/components/BattlemapScreen.vue'
import { chartsApi, vistasApi } from '@/api/docs'
import { pairScreen } from '@/api/screen'
import { resolveDuality, resolveNatural, rollClass, DUALITY_OUTCOME_LABELS, NATURAL_OUTCOME_LABELS } from '@/utils/diceNotation'

export default {
  name: 'ScreenView',
  components: { ChartCanvas, VistaCanvas, ConstellationScreen, BattlemapScreen },
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
      diceRoll: null,
      dualityLabels: DUALITY_OUTCOME_LABELS,
      naturalLabels: NATURAL_OUTCOME_LABELS,
      diceClearTimer: null,
      diceSeq: 0,
      diceWorld: null,
      activeChart: null,
      activeVista: null,
      // The GM's constellation (layout, pan/zoom, highlights); `constellationKey`
      // restarts the view whenever the GM sends it again.
      activeConstellation: null,
      constellationKey: 0,
      // The battlemap on show, as the server projected it for a screen: the id
      // is set by `display_battlemap`, the map by the `update_battlemap`s after it.
      activeBattlemap: null,
      battlemapId: null,
      // Live edit that arrived while the chart/vista it belongs to was still
      // being fetched (a screen connecting mid-edit gets both back to back).
      pendingLiveEdit: null,
      // Id being fetched per kind, so a live edit never lands on (and then
      // gets overwritten by) the saved version still on its way.
      fetching: { chart: null, vista: null },
      notPaired: false,
      reconnectTimer: null,
      pairError: '',
    }
  },
  computed: {
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
    rollClass,
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
    // Opened from a screen link (/screen#key=...): pair this device, then drop
    // the key from the address bar (the pairing cookie is what's used from
    // here on). Returns whether a key was there to pair with.
    async pairFromHash() {
      const key = new URLSearchParams(window.location.hash.slice(1)).get('key')
      if (!key) return false
      this.pairError = ''
      try {
        await pairScreen(key)
      } catch (e) {
        this.pairError = 'This screen link is invalid or has expired.'
      }
      window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
      return true
    },
    async onHashChange() {
      // Reconnect so the socket carries the new pairing cookie.
      if (await this.pairFromHash()) this.connectWebSocket()
    },
    // Detach before closing: onclose schedules a reconnect, which must not
    // fire for a socket this view is replacing or leaving behind.
    closeWebSocket() {
      clearTimeout(this.reconnectTimer)
      if (!this.ws) return
      this.ws.onclose = null
      this.ws.close()
      this.ws = null
    },
    connectWebSocket() {
      this.closeWebSocket()

      const wsUrl = socketUrl('/ws/screen')

      console.log('Connecting to screen WebSocket:', wsUrl)
      this.ws = new WebSocket(wsUrl)

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          console.log('WS message received:', data)
          
          if (data.type === 'display_media') {
            this.clearDiceRoll()
            this.activeChart = null
            this.activeVista = null
            this.activeConstellation = null
            this.clearBattlemap()
            this.updateMedia(data.url, data.title)
          } else if (data.type === 'dice_roll') {
            this.showDiceRoll(data)
          } else if (data.type === 'display_chart') {
            this.clearDiceRoll()
            this.displayUrl = ''
            this.loading = false
            this.activeVista = null
            this.activeConstellation = null
            this.clearBattlemap()
            this.pendingLiveEdit = null
            this.showChart(data.chart_id)
          } else if (data.type === 'display_vista') {
            this.clearDiceRoll()
            this.displayUrl = ''
            this.loading = false
            this.activeChart = null
            this.activeConstellation = null
            this.clearBattlemap()
            this.pendingLiveEdit = null
            this.showVista(data.vista_id)
          } else if (data.type === 'display_constellation') {
            this.clearDiceRoll()
            this.displayUrl = ''
            this.loading = false
            this.activeChart = null
            this.activeVista = null
            this.clearBattlemap()
            this.pendingLiveEdit = null
            this.constellationKey++
            this.activeConstellation = this.constellationState(data)
          } else if (data.type === 'display_battlemap') {
            this.clearDiceRoll()
            this.displayUrl = ''
            this.loading = false
            this.activeChart = null
            this.activeVista = null
            this.activeConstellation = null
            this.pendingLiveEdit = null
            this.activeBattlemap = null
            this.battlemapId = data.battlemap_id
          } else if (data.type === 'update_battlemap') {
            // The whole map as it is now: sent after the pointer, and after every change.
            if (data.battlemap_id === this.battlemapId) {
              const { type, ...projection } = data
              this.activeBattlemap = projection
            }
          } else if (data.type === 'update_constellation') {
            // Only patches the constellation that is already showing.
            if (this.activeConstellation) this.activeConstellation = this.constellationState(data)
          } else if (data.type === 'update_chart') {
            this.applyLiveEdit('chart', data)
          } else if (data.type === 'update_vista') {
            this.applyLiveEdit('vista', data)
          } else if (data.type === 'clear_screen') {
            this.displayUrl = ''
            this.displayTitle = ''
            this.loading = false
            this.activeChart = null
            this.activeVista = null
            this.activeConstellation = null
            this.clearBattlemap()
            this.pendingLiveEdit = null
            this.clearDiceRoll()
          }
        } catch (e) {
          console.error('Error parsing WS message:', e)
        }
      }

      this.ws.onopen = () => {
        console.log('WebSocket connected successfully')
        this.error = false
        this.notPaired = false
      }

      this.ws.onclose = (event) => {
        // 1008: neither signed in nor paired. Keep retrying anyway — pairing
        // (or signing in) in another tab of this browser fixes it.
        if (event.code === 1008) this.notPaired = true
        console.log(`WebSocket closed (code: ${event.code}). Retrying in 3s...`)
        this.reconnectTimer = setTimeout(() => this.connectWebSocket(), 3000)
      }

      this.ws.onerror = (err) => {
        console.error('WebSocket error:', err)
        // onclose will handle retry
      }
    },
    clearBattlemap() {
      this.activeBattlemap = null
      this.battlemapId = null
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
    },
    // The message minus its `type`: what ConstellationScreen draws from.
    constellationState(data) {
      const { type, ...state } = data
      return state
    },
    // Patches the chart/vista on screen with the GM's unsaved edits. `type`
    // and the id are only for matching; everything else is the document.
    applyLiveEdit(kind, data) {
      const { type, ...edit } = data
      const active = kind === 'chart' ? this.activeChart : this.activeVista
      const id = edit[`${kind}_id`]
      if (active && active.id === id && this.fetching[kind] !== id) {
        Object.assign(active, edit)
      } else {
        this.pendingLiveEdit = { kind, edit }
      }
    },
    takePendingLiveEdit(kind, id) {
      const pending = this.pendingLiveEdit
      if (pending?.kind !== kind || pending.edit[`${kind}_id`] !== id) return null
      this.pendingLiveEdit = null
      return pending.edit
    },
    async showChart(chartId) {
      if (!chartId) {
        this.activeChart = null
        return
      }
      this.fetching.chart = chartId
      try {
        const chart = await chartsApi.fetch(chartId)
        this.activeChart = { ...chart, ...this.takePendingLiveEdit('chart', chart.id) }
      } catch (e) {
        console.error('Failed to load chart for screen:', e)
        this.activeChart = null
      } finally {
        if (this.fetching.chart === chartId) this.fetching.chart = null
      }
    },
    async showVista(vistaId) {
      if (!vistaId) {
        this.activeVista = null
        return
      }
      this.fetching.vista = vistaId
      try {
        const vista = await vistasApi.fetch(vistaId)
        this.activeVista = { ...vista, ...this.takePendingLiveEdit('vista', vista.id) }
      } catch (e) {
        console.error('Failed to load vista for screen:', e)
        this.activeVista = null
      } finally {
        if (this.fetching.vista === vistaId) this.fetching.vista = null
      }
    },
    showDiceRoll(data) {
      if (this.diceClearTimer) clearTimeout(this.diceClearTimer)
      this.diceRoll = {
        id: ++this.diceSeq,
        formula: data.formula || '',
        label: data.label || '',
        groups: data.groups || [],
        flatModifier: data.flatModifier || 0,
        total: data.total,
        duality: resolveDuality(data.groups || []),
        natural: resolveNatural(data.groups || [])
      }
      this.diceClearTimer = setTimeout(() => {
        this.diceRoll = null
        this.diceClearTimer = null
      }, 15000)
      this.$nextTick(() => this.playDiceReplay(data.groups || [], data.diceSlot))
    },
    clearDiceRoll() {
      if (this.diceClearTimer) {
        clearTimeout(this.diceClearTimer)
        this.diceClearTimer = null
      }
      this.diceRoll = null
      this.teardownDiceWorld()
    },
    async playDiceReplay(groups, diceSlot) {
      const canvas = this.$refs.diceCanvas
      if (!canvas) return

      this.teardownDiceWorld()

      const [{ createDiceWorld }, { replayGroups }, { themeForSlot }] = await Promise.all([
        import('@/dice/diceWorld'),
        import('@/dice/diceRoller'),
        import('@/dice/diceTheme')
      ])

      // The replay may have been superseded by a newer roll (or cleared)
      // while those dynamic imports were loading.
      if (this.$refs.diceCanvas !== canvas || !this.diceRoll) return

      const world = createDiceWorld(canvas)
      this.diceWorld = world
      const rect = canvas.getBoundingClientRect()
      world.resize(rect.width || window.innerWidth, rect.height || window.innerHeight)
      await replayGroups(world, groups, themeForSlot(diceSlot))
    },
    teardownDiceWorld() {
      if (this.diceWorld) {
        this.diceWorld.dispose()
        this.diceWorld = null
      }
    }
  },
  async mounted() {
    this.$refs.root?.focus()
    this.drawStarfield()

    await this.pairFromHash()
    // A screen link pasted into a tab already on /screen only changes the
    // #fragment, which doesn't remount this view.
    window.addEventListener('hashchange', this.onHashChange)

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
    window.removeEventListener('hashchange', this.onHashChange)
    this.closeWebSocket()
    clearTimeout(this.titleTimer)
    clearTimeout(this.diceClearTimer)
    this.teardownDiceWorld()
  }
}
</script>

<style scoped>
.screen-root {
  /* Positioned content is measured in px: keep the line-height it was
     laid out with before the global type scale (body line-height 1.5). */
  line-height: normal;
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
  transition: background 1.5s var(--ease-in-out);
}

/* ─── Chart area ─── */
.screen-chart-area {
  position: relative;
  z-index: 1;
  width: 100vw;
  height: 100dvh;
}

/* ─── Battlemap area ─── */
.screen-battlemap-area {
  position: relative;
  z-index: 1;
  width: 100vw;
  height: 100dvh;
}

/* ─── Constellation area ─── */
.screen-constellation-area {
  position: relative;
  z-index: 1;
  width: 100vw;
  height: 100dvh;
}

/* ─── Vista area ─── */
.screen-vista-area {
  position: relative;
  z-index: 1;
  width: 100vw;
  height: 100dvh;
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
  height: 100dvh;
}

.screen-image-fill {
  width: 100vw;
  height: 100dvh;
  object-fit: contain; /* Prevent stretching while showing the entire image */
  user-select: none;
  transition: opacity 0.5s var(--ease-out);
}

/* ─── Caption (Subtle overlay) ─── */
.screen-caption {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 10;
  padding: var(--space-8);
  background: linear-gradient(to top, rgba(0, 0, 0, 0.8) 0%, transparent 100%);
  color: rgba(255, 255, 255, 0.9);
  font-family: var(--font-display);
  font-size: var(--text-xl);
  font-weight: 500;
  text-align: center;
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.8);
  transition: opacity 1s var(--ease-out), transform 1s var(--ease-out);
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
  gap: var(--space-6);
  color: rgba(255, 255, 255, 0.3);
  font-size: 1.2rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

/* Projector-sized spinner: conveys the waiting/loading state. */
.loading-spinner {
  width: 60px;
  height: 60px;
  border: 4px solid var(--accent-a12);
  border-top-color: var(--accent);
  border-radius: var(--radius-full);
  animation: spin 1.5s cubic-bezier(0.68, -0.55, 0.27, 1.55) infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.screen-unpaired {
  text-align: center;
  color: rgba(255, 255, 255, 0.6);
}

.screen-unpaired .mdi {
  font-size: 3rem;
}

.screen-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-4);
  color: var(--status-error);
}

.screen-error svg,
.screen-error p {
  opacity: 0.6;
}

.screen-error small {
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
}

.retry-btn {
  margin-top: var(--space-4);
  min-height: var(--control-md);
  background: var(--status-error-bg);
  border: 1px solid var(--status-error-border);
  color: var(--status-error);
  padding: 0 var(--space-6);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition:
    background-color var(--duration-base) var(--ease-out),
    color var(--duration-base) var(--ease-out),
    transform var(--duration-fast) var(--ease-out);
  pointer-events: auto;
}

.retry-btn:hover {
  background: rgba(248, 113, 113, 0.3);
  color: var(--text-primary);
}

.retry-btn:active {
  transform: translateY(1px);
}

.loading-text {
  font-size: var(--text-base);
  opacity: 0.7;
}

/* ─── Dice roll result ─── */
/* Fixed overlay above everything else - whatever was showing underneath
   (the waiting state, or an image) is untouched and reappears once this
   clears, instead of being cleared by the roll itself. */
.screen-dice-result {
  position: fixed;
  inset: 0;
  z-index: 20;
  animation: dice-result-in 0.4s cubic-bezier(0.2, 0.9, 0.3, 1.3);
}

@keyframes dice-result-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

.dice-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}

.dice-caption {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-10) var(--space-8) var(--space-12);
  background: linear-gradient(to top, rgba(2, 2, 10, 0.85) 0%, transparent 100%);
  pointer-events: none;
}

.dice-label {
  font-family: var(--font-display);
  font-size: 1.8rem;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.9);
}

.dice-formula {
  font-size: 1.4rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(199, 178, 255, 0.75);
  font-family: var(--font-mono);
}

.dice-breakdown {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--space-2);
  font-size: 1.4rem;
  font-variant-numeric: tabular-nums;
  color: rgba(255, 255, 255, 0.65);
  max-width: 80vw;
}

.dice-sign {
  margin-right: 0.4rem;
  color: rgba(255, 255, 255, 0.4);
}

.kind--hope { color: #f2c75c; }
.kind--fear { color: #f0759b; }

.dice-outcome {
  font-family: var(--font-display);
  font-size: 2.2rem;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.duality--hope .dice-outcome { color: #f2c75c; }
.duality--fear .dice-outcome { color: #f0759b; }
.duality--critical .dice-outcome {
  text-transform: uppercase;
  background: linear-gradient(90deg, #f2c75c 0%, #f0759b 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  filter: drop-shadow(0 0 30px rgba(242, 199, 92, 0.55));
}

.nat--dropped { text-decoration: line-through; opacity: 0.45; }
.nat--crit { color: #f2c75c; font-weight: 700; }
.nat--fumble { color: #f87171; font-weight: 700; }
.outcome--crit {
  color: #f2c75c;
  text-transform: uppercase;
  filter: drop-shadow(0 0 30px rgba(242, 199, 92, 0.55));
}
.outcome--fumble {
  color: #f87171;
  text-transform: uppercase;
  filter: drop-shadow(0 0 30px rgba(248, 113, 113, 0.5));
}

.dice-total {
  font-family: var(--font-display);
  font-size: 6rem;
  font-weight: 700;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  background: var(--brand-gradient);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  filter: drop-shadow(0 0 40px var(--accent-a45));
}
</style>
