<template>
  <div class="editor">
    <div v-if="status === 'loading'" class="editor-state" role="status">
      <span class="rk-spinner rk-spinner--lg"></span>
      <span>Loading map...</span>
    </div>
    <div v-else-if="status === 'gone'" class="editor-state" role="alert">
      <span class="mdi mdi-file-question-outline"></span>
      <span>This map was moved or deleted. Look for it in the Observatory.</span>
    </div>
    <div v-else-if="status === 'error'" class="editor-state editor-error" role="alert">
      <span class="mdi mdi-alert-circle-outline"></span>
      <span>{{ error }}</span>
    </div>

    <template v-else-if="doc">
      <div class="stage">
        <div class="toolbar">
          <button type="button" class="tool rk-icon-btn" :class="{ active: tool === 'select' }" :aria-pressed="tool === 'select'" title="Select and move" aria-label="Select and move" @click="tool = 'select'">
            <span class="mdi mdi-cursor-default"></span>
          </button>
          <button type="button" class="tool rk-icon-btn" :class="{ active: tool === 'ruler' }" :aria-pressed="tool === 'ruler'" title="Measure a distance" aria-label="Measure a distance" @click="tool = 'ruler'">
            <span class="mdi mdi-ruler"></span>
          </button>
          <template v-if="canInteract">
            <button type="button" class="tool rk-icon-btn" title="Add a token" aria-label="Add a token" @click="addToken">
              <span class="mdi mdi-account-plus-outline"></span>
            </button>
            <button type="button" class="tool rk-icon-btn" :class="{ active: onScreen }" :aria-pressed="onScreen" :title="onScreen ? 'Showing on the screen — click to stop' : 'Show on the screen'" :aria-label="onScreen ? 'Stop showing on the screen' : 'Show on the screen'" @click="toggleScreen">
              <span class="mdi mdi-monitor-share"></span>
            </button>
          </template>
          <span class="live-badge" :class="`live-badge--${syncStatus}`" :title="liveTitle"><span class="mdi mdi-circle-medium"></span>{{ liveLabel }}</span>
        </div>

        <BattlemapCanvas
          :image-url="doc.image_url"
          :grid="doc.grid"
          :tokens="viewTokens"
          :selected-id="selectedId"
          :tool="tool"
          :editable="canInteract"
          :reset-key="doc.id"
          @select="selectedId = $event"
          @moving="onMoving"
          @move="onMove"
        >
          <template #empty>
            <span class="mdi mdi-image-plus"></span>
            <p>This map has no image yet.</p>
            <button v-if="canInteract" type="button" class="rk-btn rk-btn--primary" @click="libraryTarget = 'map'">
              <span class="mdi mdi-folder-multiple-image"></span> Choose map image
            </button>
          </template>
        </BattlemapCanvas>
      </div>

      <aside class="panel">
        <div v-if="actionError" class="rk-alert" role="alert">
          <span class="mdi mdi-alert-circle-outline"></span>
          <span>{{ actionError }}</span>
        </div>

        <div class="tabs" role="tablist">
          <button v-for="t in TABS" :key="t.value" type="button" role="tab" class="tab" :class="{ active: tab === t.value }" :aria-selected="tab === t.value" @click="tab = t.value">{{ t.label }}</button>
        </div>

        <!-- Tokens -->
        <div v-if="tab === 'tokens'" class="tab-body">
          <label class="field">
            <span>Encounter</span>
            <select class="rk-input" :value="doc.encounter || ''" :disabled="!canInteract" @change="setEncounter($event.target.value)">
              <option value="">None</option>
              <option v-for="e in encounters" :key="e.id" :value="e.id">{{ e.id.includes('/') ? e.id : e.name }}</option>
            </select>
          </label>
          <button v-if="canInteract && encounter" type="button" class="rk-btn rk-btn--sm" :disabled="!unplaced.length" @click="placeCombatants">
            <span class="mdi mdi-account-multiple-plus-outline"></span>
            {{ unplaced.length ? `Place ${unplaced.length} combatant${unplaced.length > 1 ? 's' : ''}` : 'Everyone is on the map' }}
          </button>

          <p v-if="!doc.tokens.length" class="hint">No tokens yet. Add one, or attach an encounter and place its combatants.</p>
          <ul class="token-list">
            <li v-for="t in doc.tokens" :key="t.id">
              <button type="button" class="token-row" :class="{ active: t.id === selectedId, hidden: t.hidden }" @click="selectedId = t.id">
                <span class="token-dot" :style="{ background: t.color || DEFAULT_COLOR }"></span>
                <span class="token-name">{{ t.name || 'Unnamed' }}</span>
                <span v-if="t.hidden" class="mdi mdi-eye-off-outline" title="Hidden from the screen"></span>
              </button>
            </li>
          </ul>

          <section v-if="selected" class="inspector">
            <header class="inspector-head">
              <input class="rk-input" :value="selected.name" :disabled="!canInteract" aria-label="Token name" @change="patchToken({ name: $event.target.value.trim() })" />
              <button type="button" class="rk-icon-btn rk-icon-btn--sm danger" :disabled="!canInteract" aria-label="Remove token" title="Remove token" @click="removeToken">
                <span class="mdi mdi-trash-can-outline"></span>
              </button>
            </header>

            <div class="row">
              <label class="field">
                <span>Size (cells)</span>
                <input class="rk-input" type="number" min="0.5" max="20" step="0.5" :value="selected.size" :disabled="!canInteract" @change="patchToken({ size: clamp($event.target.value, 0.5, 20) })" />
              </label>
              <label class="check">
                <input type="checkbox" :checked="selected.hidden" :disabled="!canInteract" @change="patchToken({ hidden: $event.target.checked })" />
                <span>Hidden from the screen</span>
              </label>
            </div>

            <div class="swatches" role="group" aria-label="Token colour">
              <button v-for="c in COLORS" :key="c" type="button" class="swatch" :class="{ active: selected.color === c }" :style="{ background: c }" :aria-label="`Colour ${c}`" :disabled="!canInteract" @click="patchToken({ color: c })"></button>
            </div>

            <div class="row">
              <button type="button" class="rk-btn rk-btn--sm" :disabled="!canInteract" @click="libraryTarget = 'token'">
                <span class="mdi mdi-folder-multiple-image"></span> {{ selected.image_url ? 'Change image' : 'Choose image' }}
              </button>
              <button v-if="selected.image_url" type="button" class="rk-btn rk-btn--sm" :disabled="!canInteract" @click="patchToken({ image_url: null })">Remove image</button>
            </div>

            <label v-if="encounter" class="field">
              <span>Stands for</span>
              <select class="rk-input" :value="selected.combatant || ''" :disabled="!canInteract" @change="linkCombatant($event.target.value)">
                <option value="">No one</option>
                <option v-for="c in encounter.combatants" :key="c.id" :value="c.id">{{ c.name }}</option>
              </select>
            </label>

            <div v-if="selected.combatant" class="counters">
              <label class="check">
                <input type="checkbox" :checked="selected.show_bars" :disabled="!canInteract" @change="patchToken({ show_bars: $event.target.checked })" />
                <span>Show counters on the token</span>
              </label>
              <label v-for="name in options" :key="name" class="check indent">
                <input type="checkbox" :checked="selected.bars.includes(name)" :disabled="!canInteract" @change="toggleBar(name, $event.target.checked)" />
                <span>{{ name }}</span>
              </label>
              <p v-if="!options.length" class="hint">It has no counters.</p>
            </div>
          </section>
        </div>

        <!-- Map -->
        <div v-else class="tab-body">
          <div class="row">
            <button type="button" class="rk-btn rk-btn--sm" :disabled="!canInteract" @click="libraryTarget = 'map'">
              <span class="mdi mdi-folder-multiple-image"></span> {{ doc.image_url ? 'Change map image' : 'Choose map image' }}
            </button>
          </div>

          <fieldset class="grid-fields" :disabled="!canInteract">
            <legend>Grid</legend>
            <label class="field">
              <span>Type</span>
              <select class="rk-input" :value="doc.grid.type" @change="patchGrid({ type: $event.target.value })">
                <option value="square">Square</option>
                <option value="none">None</option>
              </select>
            </label>
            <div class="row">
              <label class="field">
                <span>Cell size (px)</span>
                <input class="rk-input" type="number" min="4" max="2000" :value="doc.grid.size" @change="patchGrid({ size: clamp($event.target.value, 4, 2000) })" />
              </label>
              <label class="field">
                <span>Offset X</span>
                <input class="rk-input" type="number" :value="doc.grid.offset_x" @change="patchGrid({ offset_x: num($event.target.value) })" />
              </label>
              <label class="field">
                <span>Offset Y</span>
                <input class="rk-input" type="number" :value="doc.grid.offset_y" @change="patchGrid({ offset_y: num($event.target.value) })" />
              </label>
            </div>
            <div class="row">
              <label class="check"><input type="checkbox" :checked="doc.grid.snap" @change="patchGrid({ snap: $event.target.checked })" /><span>Snap tokens to cells</span></label>
              <label class="check"><input type="checkbox" :checked="doc.grid.visible" @change="patchGrid({ visible: $event.target.checked })" /><span>Show the lines</span></label>
            </div>
            <label class="field">
              <span>Line opacity</span>
              <input type="range" min="0" max="1" step="0.05" :value="doc.grid.opacity" @change="patchGrid({ opacity: Number($event.target.value) })" />
            </label>
          </fieldset>

          <fieldset class="grid-fields" :disabled="!canInteract">
            <legend>Distance</legend>
            <div class="row">
              <label class="field">
                <span>One cell is</span>
                <input class="rk-input" type="number" min="0.01" step="any" :value="doc.grid.distance" @change="patchGrid({ distance: positive($event.target.value, doc.grid.distance) })" />
              </label>
              <label class="field">
                <span>Unit</span>
                <input class="rk-input" maxlength="20" :value="doc.grid.unit" @change="patchGrid({ unit: $event.target.value.trim() || 'cell' })" />
              </label>
            </div>
            <label class="field">
              <span>The ruler counts</span>
              <select class="rk-input" :value="doc.grid.measure" @change="patchGrid({ measure: $event.target.value })">
                <option value="grid">Cells (a diagonal is one)</option>
                <option value="straight">The straight line</option>
              </select>
            </label>
          </fieldset>
        </div>
      </aside>

      <ObservatoryModal
        :is-open="!!libraryTarget"
        picker-mode
        :start-path="folderOf(id)"
        @close="libraryTarget = null"
        @select="onLibrarySelect"
      />
    </template>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import BattlemapCanvas from './BattlemapCanvas.vue'
import ObservatoryModal from './ObservatoryModal.vue'
import { folderOf } from '@/composables/useObservatoryModal'
import { battlemapsApi, encountersApi } from '@/api/docs'
import { TOKEN_COLORS } from '@/utils/palette'
import { errorMessage } from '@/api/http'
import { screenApi } from '@/api/screen'
import { useSyncedDoc, useSyncedDocFollowing } from '@/composables/useSyncedDoc'
import { useCharacters } from '@/composables/useCharacters'
import { syncStatus } from '@/composables/syncSocket'
import { barOptions, metersFor } from '@/utils/battlemapMeters'
import { freeCells } from '@/utils/battlemapGeometry'

// One battlemap, live: everyone who has it open sees tokens move as they are
// moved. Nothing here saves; each action is a command (api/docs.js) and the
// server announces its result. What the screen shows is made by the server.
const props = defineProps({
  battlemapId: { type: String, required: true },
  canInteract: { type: Boolean, default: false }
})

const id = props.battlemapId
const { commands } = battlemapsApi
const { doc, status, error, commit } = useSyncedDoc('battlemap', id, () => battlemapsApi.fetch(id))
// The encounter whose combatants the tokens stand for, followed live too (a
// token shows its combatant's counters as they change).
const { doc: encounter } = useSyncedDocFollowing('encounter', () => doc.value?.encounter || null, (encounterId) => encountersApi.fetch(encounterId))
// And the saved values of its characters, one live document each.
const characters = useCharacters(() => (encounter.value?.combatants || []).filter((c) => c.type === 'character').map((c) => c.sheet))

const TABS = [{ value: 'tokens', label: 'Tokens' }, { value: 'map', label: 'Map' }]
const COLORS = TOKEN_COLORS
const DEFAULT_COLOR = COLORS[0]

const tab = ref('tokens')
const tool = ref('select')
const selectedId = ref(null)
const libraryTarget = ref(null) // 'map' | 'token'
const encounters = ref([])
const actionError = ref('')
const onScreen = ref(false)

const LIVE = {
  open: ['Live', 'Changes appear for everyone as they are made'],
  connecting: ['Connecting…', 'Waiting for the connection: changes may be late'],
  denied: ['Signed out', 'Sign in again to see changes live'],
  idle: ['Connecting…', '']
}
const liveLabel = computed(() => LIVE[syncStatus.value][0])
const liveTitle = computed(() => LIVE[syncStatus.value][1])

// The encounters to choose from, once signed in (the session check may still
// be on its way when the editor opens).
watch(() => props.canInteract, (signedIn) => {
  if (signedIn) encountersApi.fetchAll().then((all) => { encounters.value = all }).catch(() => {})
}, { immediate: true })

const viewTokens = computed(() =>
  (doc.value?.tokens || []).map((token) => ({ ...token, meters: metersFor(token, encounter.value, characters.docs.value) }))
)
const selected = computed(() => doc.value?.tokens.find((t) => t.id === selectedId.value) || null)
const options = computed(() => (selected.value ? barOptions(selected.value, encounter.value, characters.docs.value) : []))
const unplaced = computed(() => {
  const placed = new Set((doc.value?.tokens || []).map((t) => t.combatant).filter(Boolean))
  return (encounter.value?.combatants || []).filter((c) => !placed.has(c.id))
})

const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0)
const clamp = (value, low, high) => Math.min(high, Math.max(low, num(value)))
const positive = (value, fallback) => (num(value) > 0 ? num(value) : fallback)

async function attempt(work) {
  actionError.value = ''
  try {
    await work
    return true
  } catch (err) {
    actionError.value = errorMessage(err)
    return false
  }
}

/** Runs a command on this map: the event it returns is applied at once. */
const send = (command) => attempt(commit(command))

const patchToken = (patch) => send(commands.patchItem(id, 'tokens', selected.value.id, patch))
const patchGrid = (patch) => send(commands.patch(id, { grid: patch }))
const setEncounter = (encounterId) => send(commands.patch(id, { encounter: encounterId || null }))

function addToken() {
  const [{ x, y }] = freeCells(1, doc.value.tokens)
  send(commands.addItems(id, 'tokens', [{ name: 'Token', x, y, size: 1 }]))
}

function removeToken() {
  if (!window.confirm(`Remove ${selected.value.name || 'this token'} from the map?`)) return
  const tokenId = selected.value.id
  selectedId.value = null
  send(commands.removeItem(id, 'tokens', tokenId))
}

function placeCombatants() {
  const cells = freeCells(unplaced.value.length, doc.value.tokens)
  const items = unplaced.value.map((c, index) => ({
    name: c.name,
    combatant: c.id,
    sheet: c.sheet || null,
    image_url: c.image_url || null,
    color: c.type === 'character' ? '#34d399' : null,
    x: cells[index].x,
    y: cells[index].y,
    size: 1
  }))
  send(commands.addItems(id, 'tokens', items))
}

function linkCombatant(combatantId) {
  const combatant = encounter.value?.combatants.find((c) => c.id === combatantId)
  patchToken({ combatant: combatantId || null, sheet: combatant?.sheet || null, bars: [], show_bars: false })
}

// One bar in or out, never the whole list, so two people changing the bars
// at once both count.
const toggleBar = (name, on) =>
  send(commands.editList(id, 'tokens', selected.value.id, 'bars', on ? { add: [name] } : { remove: [name] }))

// A token being dragged is sent as it moves, at most every MOVE_INTERVAL ms,
// so everyone sees it travel; where it is dropped is sent at once.
//
// Moves go out one at a time, the newest position of each token: requests in
// flight together can reach the server in any order, and an older one landing
// after the drop would put the token back where it was a moment ago.
const MOVE_INTERVAL = 80
let pendingMove = null
let moveTimer = null
const queuedMoves = new Map() // token id -> position
let sending = null

function sendMove(tokenId, position) {
  queuedMoves.set(tokenId, position)
  sending ||= (async () => {
    try {
      while (queuedMoves.size) {
        const [token, at] = queuedMoves.entries().next().value
        queuedMoves.delete(token)
        await send(commands.patchItem(id, 'tokens', token, at))
      }
    } finally {
      sending = null // in the same tick as the last look at the queue: nothing can slip in between
    }
  })()
  return sending
}

function onMoving(tokenId, position) {
  pendingMove = { tokenId, position }
  if (moveTimer) return
  moveTimer = setTimeout(() => {
    moveTimer = null
    if (pendingMove) sendMove(pendingMove.tokenId, pendingMove.position)
    pendingMove = null
  }, MOVE_INTERVAL)
}

function onMove(tokenId, position) {
  clearTimeout(moveTimer)
  moveTimer = null
  pendingMove = null
  sendMove(tokenId, position)
}

onBeforeUnmount(() => clearTimeout(moveTimer))

function onLibrarySelect(item) {
  const target = libraryTarget.value
  libraryTarget.value = null
  if (target === 'map') send(commands.patch(id, { image_url: item.image_url }))
  else if (target === 'token' && selected.value) patchToken({ image_url: item.image_url })
}

async function toggleScreen() {
  const wasShowing = onScreen.value
  const done = await attempt(
    wasShowing ? screenApi.clear() : screenApi.battlemap(id)
  )
  if (done) onScreen.value = !wasShowing
}
</script>

<style scoped>
.editor {
  flex: 1;
  min-height: 0;
  display: flex;
}

.editor-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  color: var(--text-secondary);
  font-size: var(--text-sm);
}

.editor-error {
  color: var(--status-error);
}

.stage {
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.toolbar {
  position: absolute;
  top: var(--space-3);
  left: var(--space-3);
  z-index: var(--z-raised);
  display: flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-1);
  background: var(--surface-chrome);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.tool.active {
  background: var(--accent-a30);
  color: var(--text-primary);
}

.live-badge {
  display: inline-flex;
  align-items: center;
  padding-right: var(--space-2);
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.live-badge--open {
  color: var(--status-success);
}

.live-badge--connecting,
.live-badge--denied {
  color: var(--status-warning);
}

.panel {
  flex: none;
  width: 20rem;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);
  overflow-y: auto;
  border-left: 1px solid var(--border-light);
  background: var(--surface-chrome);
}

.tabs {
  display: flex;
  gap: var(--space-1);
  border-bottom: 1px solid var(--border-light);
}

.tab {
  padding: var(--space-2) var(--space-4);
  margin-bottom: -1px;
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  font-size: var(--text-sm);
  font-weight: 500;
  cursor: pointer;
}

.tab.active {
  color: var(--text-primary);
  border-bottom-color: var(--accent);
}

.tab-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  flex: 1;
  min-width: 0;
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: var(--space-2);
}

.check {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-sm);
  color: var(--text-secondary);
}

.check.indent {
  padding-left: var(--space-5);
}

.hint {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--text-muted);
}

.token-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.token-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-2);
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  font-size: var(--text-sm);
  text-align: left;
  cursor: pointer;
}

.token-row:hover {
  background: var(--hover-tint);
}

.token-row.active {
  border-color: var(--accent);
  background: var(--accent-a12);
  color: var(--text-primary);
}

.token-row.hidden {
  opacity: 0.6;
}

.token-dot {
  flex: none;
  width: 0.8rem;
  height: 0.8rem;
  border-radius: var(--radius-full);
}

.token-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.inspector {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-3);
  background: var(--surface-sunken);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg);
}

.inspector-head {
  display: flex;
  gap: var(--space-2);
}

.inspector-head input {
  flex: 1;
}

.swatches {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}

.swatch {
  width: 1.4rem;
  height: 1.4rem;
  border: 2px solid transparent;
  border-radius: var(--radius-full);
  cursor: pointer;
}

.swatch.active {
  border-color: #fff;
}

.counters {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.grid-fields {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding: var(--space-3);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg);
  min-width: 0;
}

.grid-fields legend {
  padding: 0 var(--space-2);
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-secondary);
}

@media (max-width: 900px) {
  .editor {
    flex-direction: column;
  }

  .stage {
    flex: none;
    height: 55%;
  }

  .panel {
    width: auto;
    flex: 1;
    border-left: none;
    border-top: 1px solid var(--border-light);
  }
}
</style>
