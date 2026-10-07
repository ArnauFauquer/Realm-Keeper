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
      <BattlemapScreen :state="activeBattlemap" :signals="mapSignals" />
    </div>

    <!-- Constellation area: restarted each time the GM sends it again -->
    <div v-else-if="activeConstellation" class="screen-constellation-area">
      <ConstellationScreen :key="scene.seq" :state="activeConstellation" />
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

      <!-- 4. The actual media (rendered even if loading to trigger @load);
           a retry changes the key, which loads it again. -->
      <img
        v-if="displayUrl && isImage"
        v-show="!loading && !error"
        :src="displayUrl"
        :key="`${displayUrl}#${mediaAttempt}`"
        :alt="displayTitle"
        class="screen-image-fill"
        @load="onMediaLoad"
        @error="onMediaError"
        draggable="false"
      />
    </div>

    <!-- Dice roll overlay - sits on top of whatever is showing above (waiting
         state or an image) without touching its state, so that content is
         still there, untouched, once the roll's display timer clears it.
         The canvas stays mounted between rolls: the screen keeps one dice
         world (one WebGL context, shaders compiled once) for all of them. -->
    <div v-show="diceRoll" class="screen-dice-result" :class="diceRoll?.duality && `duality--${diceRoll.duality.outcome}`">
      <canvas ref="diceCanvas" class="dice-canvas"></canvas>
      <div v-if="diceRoll" class="dice-caption" :key="diceRoll.id">
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
        <div v-if="diceRoll.duality" class="dice-outcome">{{ DUALITY_OUTCOME_LABELS[diceRoll.duality.outcome] }}</div>
        <div v-if="diceRoll.natural?.critical" class="dice-outcome outcome--crit">{{ NATURAL_OUTCOME_LABELS.critical }}</div>
        <div v-if="diceRoll.natural?.fumble" class="dice-outcome outcome--fumble">{{ NATURAL_OUTCOME_LABELS.fumble }}</div>
      </div>
    </div>

    <!-- An image's title, shown for a few seconds once it has loaded. -->
    <div class="screen-caption" :class="{ hidden: !showTitle }" v-if="displayTitle">
      {{ displayTitle }}
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ChartCanvas from '@/components/ChartCanvas.vue'
import VistaCanvas from '@/components/VistaCanvas.vue'
import ConstellationScreen from '@/components/ConstellationScreen.vue'
import BattlemapScreen from '@/components/BattlemapScreen.vue'
import { chartsApi, vistasApi } from '@/api/docs'
import { useScreenSocket } from '@/composables/useScreenSocket'
import { drawStarfield } from '@/composables/useConstellationGraph'
import { EMPTY_SCENE, changesScene, reduceScene, screenMediaUrl } from '@/utils/screenScene'
import { createSignalLayer } from '@/utils/mapSignals'
import { resolveDuality, resolveNatural, rollClass, DUALITY_OUTCOME_LABELS, NATURAL_OUTCOME_LABELS } from '@/utils/diceNotation'

const route = useRoute()
const router = useRouter()

const root = ref(null)
const starCanvas = ref(null)
const diceCanvas = ref(null)

// ─── The scene (utils/screenScene.js) ───
const scene = shallowRef(EMPTY_SCENE)
const activeChart = computed(() => scene.value.kind === 'chart' ? scene.value.doc : null)
const activeVista = computed(() => scene.value.kind === 'vista' ? scene.value.doc : null)
const activeBattlemap = computed(() => scene.value.kind === 'battlemap' ? scene.value.battlemap : null)
const activeConstellation = computed(() => scene.value.kind === 'constellation' ? scene.value.constellation : null)
const displayUrl = computed(() => scene.value.url)
const displayTitle = computed(() => scene.value.title)

function dispatch(message) {
  scene.value = reduceScene(scene.value, message)
}

// Fetches the chart/vista a scene asks for; the reducer only takes the
// result while that scene (its `seq`) is still the one showing.
async function fetchSceneDoc({ kind, id, seq }) {
  const api = kind === 'chart' ? chartsApi : vistasApi
  try {
    const doc = await api.fetch(id)
    dispatch({ type: 'scene_loaded', seq, doc })
  } catch (e) {
    console.error(`Failed to load ${kind} for screen:`, e)
    dispatch({ type: 'scene_failed', seq })
  }
}

// Pings, the pointer and rolls over tokens on the battlemap showing: drawn
// over it for a moment, and kept nowhere.
const mapSignals = createSignalLayer()

function onMessage(data) {
  if (data.type === 'dice_roll') {
    showDiceRoll(data)
    return
  }
  if (data.type === 'battlemap_signal') {
    if (activeBattlemap.value && data.battlemap_id === scene.value.id) mapSignals.receive(data)
    return
  }
  const newScene = changesScene(data)
  if (newScene) {
    clearDiceRoll()
    mapSignals.clear()
  }
  const previousUrl = displayUrl.value
  const hasMedia = data.type === 'display_media' && data.url
  dispatch(hasMedia ? { ...data, url: screenMediaUrl(data.url, window.location.hostname) } : data)
  if (hasMedia) {
    showMedia(previousUrl)
  } else if (newScene) {
    loading.value = false
    error.value = false
  }
  if (newScene && scene.value.loading) fetchSceneDoc(scene.value)
}

const { notPaired, pairError, start: connect } = useScreenSocket({
  onMessage,
  onOpen: () => { error.value = false }
})

// ─── Media ───
const loading = ref(true)
const error = ref(false)
const showTitle = ref(false)
const mediaAttempt = ref(0)
const dominantColor = ref(null)
let titleTimer = null

const isImage = computed(() => {
  if (!displayUrl.value) return false
  const url = displayUrl.value.toLowerCase()
  return /\.(png|jpe?g|gif|webp|svg|avif|bmp|tiff?)(\?.*)?$/.test(url) || !displayUrl.value.match(/\.(mp4|webm|ogg|mp3|wav|flac)(\?.*)?$/)
})

const glowStyle = computed(() => {
  if (dominantColor.value) {
    return { background: `radial-gradient(ellipse at center, ${dominantColor.value}40 0%, transparent 70%)` }
  }
  return { background: 'radial-gradient(ellipse at center, rgba(138, 92, 245, 0.2) 0%, transparent 70%)' }
})

// The image already up, sent again, doesn't load again (which would get
// stuck in the loading spinner): only its title comes back.
function showMedia(previousUrl) {
  error.value = false
  if (displayUrl.value === previousUrl) {
    loading.value = false
    triggerTitle()
  } else {
    loading.value = true
  }
}

function onMediaLoad() {
  loading.value = false
  error.value = false
  triggerTitle()
}

function onMediaError() {
  loading.value = false
  error.value = true
}

function retry() {
  error.value = false
  loading.value = true
  mediaAttempt.value++
}

function triggerTitle() {
  showTitle.value = true
  clearTimeout(titleTimer)
  titleTimer = setTimeout(() => {
    showTitle.value = false
  }, 5000)
}

function close() {
  // Allow exiting fullscreen mode
  if (window.history.length > 1) {
    router.go(-1)
  } else {
    router.push('/')
  }
}

// ─── Dice ───
// One dice world for the screen, built on the first roll and kept: each roll
// stops the one before (its tumble is aborted), clears its dice and throws
// its own. A screen without WebGL still shows the roll's caption.
const diceRoll = ref(null)
let diceSeq = 0
let diceClearTimer = null
let diceWorld = null
let diceUnavailable = false
let diceAbort = null
let diceModules = null

function loadDiceModules() {
  diceModules ??= Promise.all([
    import('@/dice/diceWorld'),
    import('@/dice/diceRoller'),
    import('@/dice/diceTheme')
  ]).then(([world, roller, theme]) => ({
    createDiceWorld: world.createDiceWorld,
    replayGroups: roller.replayGroups,
    themeForSlot: theme.themeForSlot
  }))
  // A failed load (offline for a moment) is tried again on the next roll.
  diceModules.catch(() => { diceModules = null })
  return diceModules
}

function showDiceRoll(data) {
  clearTimeout(diceClearTimer)
  diceRoll.value = {
    id: ++diceSeq,
    formula: data.formula || '',
    // Who rolled: the character/adversary of a sheet roll ("Bugboar ·
    // Gore"), else the player who rolled from the dice panel or a note.
    label: data.label || data.roller || '',
    groups: data.groups || [],
    flatModifier: data.flatModifier || 0,
    total: data.total,
    duality: resolveDuality(data.groups || []),
    natural: resolveNatural(data.groups || [])
  }
  diceClearTimer = setTimeout(clearDiceRoll, 15000)
  playDiceReplay(data.groups || [], data.diceSlot)
}

function clearDiceRoll() {
  clearTimeout(diceClearTimer)
  diceClearTimer = null
  diceRoll.value = null
  stopDiceReplay()
}

// Also draws the emptied tray, so the next roll doesn't open on the last
// frame of this one.
function stopDiceReplay() {
  diceAbort?.abort()
  diceAbort = null
  diceWorld?.clearDice()
  diceWorld?.render()
}

async function playDiceReplay(groups, diceSlot) {
  stopDiceReplay()
  if (diceUnavailable) return
  const abort = new AbortController()
  diceAbort = abort
  let dice
  try {
    // The overlay (and its canvas) is shown on the next render.
    ;[dice] = await Promise.all([loadDiceModules(), nextTick()])
  } catch (e) {
    console.error('Could not load the dice:', e)
    return
  }
  // Superseded by a newer roll (or cleared) while loading.
  if (abort.signal.aborted) return
  const world = ensureDiceWorld(dice.createDiceWorld)
  if (!world) return
  await dice.replayGroups(world, groups, dice.themeForSlot(diceSlot), { signal: abort.signal })
}

function ensureDiceWorld(createDiceWorld) {
  if (diceWorld) return diceWorld
  if (!diceCanvas.value) return null
  try {
    diceWorld = createDiceWorld(diceCanvas.value)
  } catch (e) {
    // No WebGL on this device: the caption shows the roll on its own.
    console.warn('No 3D dice on this screen:', e)
    diceUnavailable = true
    return null
  }
  sizeDiceWorld()
  return diceWorld
}

function sizeDiceWorld() {
  const canvas = diceCanvas.value
  if (!diceWorld || !canvas) return
  const rect = canvas.getBoundingClientRect()
  diceWorld.resize(rect.width || window.innerWidth, rect.height || window.innerHeight)
}

// ─── Lifecycle ───
onMounted(async () => {
  root.value?.focus()
  drawStarfield(starCanvas.value, window.innerWidth, window.innerHeight, {
    density: 3500,
    sizeRanges: [[0.3, 0.9], [0.9, 1.6], [1.6, 2.8]],
    opacityRange: [0.12, 0.55],
    hueRange: [210, 265],
    // The screen's own backdrop, as it was before it shared this drawing.
    sizeOdds: [0.65, 0.88],
    saturation: 55,
    lightness: 92
  })
  window.addEventListener('resize', sizeDiceWorld)

  // Media passed in the address (/screen?url=...&title=...) shows straight away.
  if (route.query.url) onMessage({ type: 'display_media', url: route.query.url, title: route.query.title })

  await connect()
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', sizeDiceWorld)
  clearTimeout(titleTimer)
  clearDiceRoll()
  diceWorld?.dispose()
  diceWorld = null
})
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
  /* Keyed per roll, so a roll replacing one still on screen fades in too. */
  animation: dice-result-in 0.4s cubic-bezier(0.2, 0.9, 0.3, 1.3);
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
