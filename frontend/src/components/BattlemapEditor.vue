<template>
  <div class="editor">
    <LiveDocumentState v-if="unavailable" class="editor-state" :status="status" :error="error" noun="map" />

    <template v-else-if="doc">
      <div class="stage">
        <BattlemapCanvas
          :image-url="doc.image_url"
          :grid="doc.grid"
          :tokens="viewTokens"
          :areas="doc.areas || []"
          :selected-id="selectedId"
          :selected-area-id="selectedAreaId"
          :tool="tool"
          :area-shape="areaShape"
          :editable="canInteract"
          :reset-key="doc.id"
          :signals="signals.layer"
          @select="selectToken"
          @select-area="selectArea"
          @move="onMove"
          @move-area="moveArea"
          @reshape-area="moveArea"
          @add-area="addArea"
          @open="selectToken"
          @ping="signals.ping"
          @point="signals.point"
          @release="signals.release"
          @measure="signals.measure"
          @view="onView"
        >
          <template #empty-actions>
            <button v-if="canInteract" type="button" class="rk-btn rk-btn--primary" @click="openLibrary('map')">
              <span class="mdi mdi-folder-multiple-image"></span> Choose map image
            </button>
          </template>
        </BattlemapCanvas>

        <BattlemapTools
          v-if="doc.image_url"
          v-model:tool="tool"
          v-model:area-shape="areaShape"
          :tools="visibleTools"
          :shapes="AREA_SHAPES"
        />

        <div class="stage-status">
          <LiveBadge />
        </div>
      </div>

      <aside class="panel" aria-label="Map panel">
        <!-- Setting the map up: once, before it is played on. -->
        <template v-if="view === 'setup'">
          <header class="panel-head">
            <button type="button" class="back" @click="view = 'main'">
              <span class="mdi mdi-chevron-left"></span> Back
            </button>
            <h2 class="panel-title">Map setup</h2>
          </header>
          <div v-if="actionError" class="rk-alert" role="alert">
            <span class="mdi mdi-alert-circle-outline"></span>
            <span>{{ actionError }}</span>
          </div>
          <BattlemapSetup
            :map="doc"
            :encounters="encounters"
            :creating-encounter="creatingEncounter"
            :disabled="!canInteract"
            @patch-grid="patchGrid"
            @set-encounter="setEncounter"
            @create-encounter="createEncounter"
            @choose-image="openLibrary('map')"
          />
        </template>

        <!-- One of them, opened: whoever a token stands for, a token, an area. -->
        <template v-else-if="opened">
          <header class="panel-head">
            <button type="button" class="back" @click="closeDetail">
              <span class="mdi mdi-chevron-left"></span> Everyone
            </button>
            <button
              v-if="hideable && canInteract"
              type="button"
              class="rk-btn rk-btn--sm rk-btn--ghost visibility"
              :class="{ off: hideable.hidden }"
              :aria-pressed="!!hideable.hidden"
              :title="hideable.hidden ? 'Only the table sees it: click to show it on the screen' : 'Seen on the screen: click to hide it from the players'"
              @click="toggleHidden"
            >
              <span class="mdi" :class="hideable.hidden ? 'mdi-eye-off-outline' : 'mdi-eye-outline'"></span>
              {{ hideable.hidden ? 'Hidden' : 'Visible' }}
            </button>
          </header>
          <div v-if="actionError" class="rk-alert" role="alert">
            <span class="mdi mdi-alert-circle-outline"></span>
            <span>{{ actionError }}</span>
          </div>

          <template v-if="opened.kind === 'combatant'">
            <CombatantPlay
              :key="focused.id"
              :combatant="focused"
              :counters="countersOf(focused)"
              :sheet-state="sheetOf(focused)"
              :image-url="openedToken?.image_url || null"
              :can-interact="canInteract"
              @adjust="(name, by) => adjust(focused, name, by)"
              @patch="(fields) => patchCombatant(focused, fields)"
              @add-condition="(name) => addCondition(focused, name)"
              @remove-condition="(condition) => removeCondition(focused, condition)"
              @rolled="onRolled"
              @edit-sheet="editSheet(focused)"
            />
            <details v-if="openedToken" class="token-section">
              <summary>
                <span class="mdi mdi-chevron-right" aria-hidden="true"></span>
                Token on the map
              </summary>
              <TokenSettings
                :token="openedToken"
                :counters="barNames"
                :combatants="encounter.combatants"
                :disabled="!canInteract"
                @patch="patchToken"
                @toggle-bar="toggleBar"
                @link="linkCombatant"
                @choose-image="openLibrary('token')"
                @remove="removeToken"
              />
            </details>
            <button v-else-if="canInteract" type="button" class="rk-btn rk-btn--sm place-one" @click="place([focused])">
              <span class="mdi mdi-map-marker-plus-outline"></span> Put {{ focused.name }} on the map
            </button>
          </template>

          <template v-else-if="opened.kind === 'token'">
            <div class="detail-head">
              <span class="avatar avatar--lg" :style="{ '--avatar': openedToken.color || DEFAULT_COLOR }">
                <img v-if="openedToken.image_url" :src="resolveUrl(openedToken.image_url)" alt="" />
                <template v-else>{{ initials(openedToken.name) }}</template>
              </span>
              <div class="detail-title">
                <h3 class="detail-name">{{ openedToken.name || 'Unnamed token' }}</h3>
                <p class="detail-sub">Stands for no one</p>
              </div>
            </div>
            <TokenSettings
              :token="openedToken"
              :combatants="encounter?.combatants || null"
              :disabled="!canInteract"
              @patch="patchToken"
              @link="linkCombatant"
              @choose-image="openLibrary('token')"
              @remove="removeToken"
            />
          </template>

          <AreaInspector
            v-else
            :area="openedArea"
            :grid="doc.grid"
            :disabled="!canInteract"
            @patch="patchArea"
            @remove="removeArea"
          />
        </template>

        <!-- Everyone and everything on the map. -->
        <template v-else>
          <header class="panel-head">
            <h2 class="panel-title">On the map</h2>
            <button v-if="canInteract" type="button" class="rk-btn rk-btn--sm rk-btn--ghost setup-btn" title="Image, encounter, grid and distances" @click="view = 'setup'">
              <span class="mdi mdi-cog-outline"></span> Setup
            </button>
          </header>
          <div v-if="actionError" class="rk-alert" role="alert">
            <span class="mdi mdi-alert-circle-outline"></span>
            <span>{{ actionError }}</span>
          </div>

          <div v-if="!encounter && canInteract" class="encounter-cta">
            <span class="mdi mdi-sword-cross" aria-hidden="true"></span>
            <div class="encounter-cta-body">
              <p class="encounter-cta-title">Play the fight from here</p>
              <p>Link an encounter to roll and track counters and conditions on the map, for everyone at once.</p>
              <div class="encounter-cta-actions">
                <select class="rk-input" :value="doc.encounter || ''" aria-label="Encounter" @change="setEncounter($event.target.value)">
                  <option value="">Link an encounter…</option>
                  <option v-for="e in encounters" :key="e.id" :value="e.id">{{ e.id.includes('/') ? e.id : e.name }}</option>
                </select>
                <button type="button" class="rk-btn rk-btn--sm" :disabled="creatingEncounter" @click="createEncounter">
                  <span class="mdi mdi-plus"></span> New
                </button>
              </div>
            </div>
          </div>

          <section v-if="encounter" class="group" aria-labelledby="group-fight">
            <div class="group-head">
              <h3 id="group-fight" class="group-title">In the fight <span class="count">{{ encounter.combatants.length }}</span></h3>
              <button v-if="canInteract" type="button" class="rk-btn rk-btn--sm rk-btn--ghost add-fight" :aria-expanded="adding" @click="adding = !adding">
                <span class="mdi" :class="adding ? 'mdi-check' : 'mdi-plus'"></span> {{ adding ? 'Done' : 'Add' }}
              </button>
            </div>
            <EncounterAddPanel
              v-if="adding && canInteract"
              :present-characters="presentCharacters"
              @add="addFromSheet"
              @add-custom="addCustom"
            />
            <ul v-if="encounter.combatants.length" class="rows">
              <li v-for="c in encounter.combatants" :key="c.id">
                <button
                  type="button"
                  class="row combatant-row"
                  :class="{ active: c.id === focusId, defeated: c.defeated, unplaced: !tokenOf(c) }"
                  @click="focusCombatant(c)"
                >
                  <span class="avatar" :style="{ '--avatar': tokenOf(c)?.color || (c.type === 'character' ? CHARACTER_COLOR : DEFAULT_COLOR) }">
                    <img v-if="portraitOf(c)" :src="portraitOf(c)" alt="" />
                    <template v-else>{{ initials(c.name) }}</template>
                  </span>
                  <span class="row-main">
                    <span class="row-name">{{ c.name }}</span>
                    <span class="row-sub">{{ c.defeated ? 'Defeated' : !tokenOf(c) ? 'Not on the map' : c.type === 'character' ? 'Character' : 'Adversary' }}</span>
                  </span>
                  <span v-if="tokenOf(c)?.hidden" class="mdi mdi-eye-off-outline row-flag" title="Hidden from the screen"></span>
                  <span v-if="leadCounter(c)" class="row-counter" :title="leadCounter(c).name">
                    {{ leadCounter(c).current }}<small>/{{ leadCounter(c).max }} {{ leadCounter(c).name }}</small>
                  </span>
                </button>
              </li>
            </ul>
            <p v-else class="hint">Nobody yet. Add characters and adversaries to play their sheets from here.</p>
            <button v-if="canInteract && unplaced.length && encounter.combatants.length" type="button" class="rk-btn rk-btn--sm place-all" @click="placeCombatants">
              <span class="mdi mdi-map-marker-multiple-outline"></span>
              Put {{ unplaced.length }} on the map
            </button>
          </section>

          <section v-if="freeTokens.length || canInteract" class="group" aria-labelledby="group-tokens">
            <div class="group-head">
              <h3 id="group-tokens" class="group-title">{{ encounter ? 'Other tokens' : 'Tokens' }} <span v-if="freeTokens.length" class="count">{{ freeTokens.length }}</span></h3>
              <button v-if="canInteract" type="button" class="rk-btn rk-btn--sm rk-btn--ghost" aria-label="Add a token" @click="addToken">
                <span class="mdi mdi-plus"></span> Add
              </button>
            </div>
            <ul v-if="freeTokens.length" class="rows">
              <li v-for="t in freeTokens" :key="t.id">
                <button type="button" class="row token-row" :class="{ active: t.id === selectedId, hidden: t.hidden }" @click="selectToken(t.id)">
                  <span class="avatar" :style="{ '--avatar': t.color || DEFAULT_COLOR }">
                    <img v-if="t.image_url" :src="resolveUrl(t.image_url)" alt="" />
                    <template v-else>{{ initials(t.name) }}</template>
                  </span>
                  <span class="row-main"><span class="row-name">{{ t.name || 'Unnamed' }}</span></span>
                  <span v-if="t.hidden" class="mdi mdi-eye-off-outline row-flag" title="Hidden from the screen"></span>
                </button>
              </li>
            </ul>
            <p v-else class="hint">Markers, objects, anyone without a sheet.</p>
          </section>

          <section v-if="(doc.areas || []).length || canInteract" class="group" aria-labelledby="group-areas">
            <div class="group-head">
              <h3 id="group-areas" class="group-title">Areas <span v-if="(doc.areas || []).length" class="count">{{ doc.areas.length }}</span></h3>
              <button v-if="canInteract" type="button" class="rk-btn rk-btn--sm rk-btn--ghost" :class="{ active: tool === 'area' }" @click="tool = 'area'">
                <span class="mdi mdi-shape-outline"></span> Draw
              </button>
            </div>
            <ul v-if="(doc.areas || []).length" class="rows">
              <li v-for="a in doc.areas" :key="a.id">
                <button type="button" class="row area-row" :class="{ active: a.id === selectedAreaId, hidden: a.hidden }" @click="selectArea(a.id)">
                  <span class="avatar avatar--shape" :style="{ '--avatar': a.color || AREA_COLORS[0] }">
                    <span class="mdi" :class="AREA_ICONS[a.shape]"></span>
                  </span>
                  <span class="row-main"><span class="row-name">{{ a.label || AREA_LABELS[a.shape] }}</span></span>
                  <span v-if="a.hidden" class="mdi mdi-eye-off-outline row-flag" title="Hidden from the screen"></span>
                  <span class="row-counter area-size">{{ areaMeasure(doc.grid, a) }}</span>
                </button>
              </li>
            </ul>
            <p v-else class="hint">Spell reaches, zones, hazards. Pick Draw, then drag on the map.</p>
          </section>
        </template>
      </aside>

      <ObservatoryModal
        :is-open="libraryOpen"
        picker-mode
        :start-path="folderOf(id)"
        @close="closeLibrary"
        @select="onLibrarySelect"
      />
    </template>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import BattlemapCanvas from './BattlemapCanvas.vue'
import BattlemapTools from './BattlemapTools.vue'
import BattlemapSetup from './BattlemapSetup.vue'
import ObservatoryModal from './ObservatoryModal.vue'
import { folderOf } from '@/composables/useObservatoryModal'
import { battlemapsApi, encountersApi } from '@/api/docs'
import { AREA_COLORS, TOKEN_COLORS } from '@/utils/palette'
import { useLibraryPicker } from '@/composables/useLibraryPicker'
import { screenApi } from '@/api/screen'
import { useFlash } from '@/composables/useFlash'
import { useDocumentScreen } from '@/composables/useDocumentScreen'
import { useSyncedDocFollowing } from '@/composables/useSyncedDoc'
import { useLiveDocument } from '@/composables/useLiveDocument'
import LiveBadge from './LiveBadge.vue'
import LiveDocumentState from './LiveDocumentState.vue'
import { useCharacters } from '@/composables/useCharacters'
import { barOptions, metersFor } from '@/utils/battlemapMeters'
import { areaMeasure, freeCells, initials } from '@/utils/battlemapGeometry'
import { combatantsFromSheet, customCombatant } from '@/utils/encounter'
import { resolveUrl } from '@/utils/resolveUrl'
import CombatantPlay from './CombatantPlay.vue'
import EncounterAddPanel from './EncounterAddPanel.vue'
import TokenSettings from './TokenSettings.vue'
import AreaInspector, { AREA_SHAPES } from './AreaInspector.vue'
import { useCombatantActions, useCombatantSheets } from '@/composables/useCombatantActions'
import { useMapSignals } from '@/composables/useMapSignals'
import { useDocModal } from '@/composables/useDocModal'

// One battlemap, live: everyone who has it open sees tokens move as they are
// moved, areas laid, rulers measured and its combatants played. Nothing here
// saves; each action is a command (api/docs.js) and the server announces its
// result. What the screen shows is made by the server.
//
// The map takes the room; beside it, one panel that is about one thing at a
// time: everyone on the map (the default), one of them opened (a click on its
// token or its row: whoever it stands for, played from their sheet, or the
// token itself, or an area), or the map's setup (behind Setup, as it is done
// once, not during play).
const props = defineProps({
  battlemapId: { type: String, required: true },
  canInteract: { type: Boolean, default: false }
})

const id = props.battlemapId
const { commands } = battlemapsApi
// Each action is a command (`send`): the event it returns is applied at once.
const { doc, status, error, actionError, unavailable, attempt, send, commit } = useLiveDocument('battlemap', id, () => battlemapsApi.fetch(id))
// The encounter whose combatants the tokens stand for, followed live too (a
// token shows its combatant's counters as they change).
const followed = useSyncedDocFollowing('encounter', () => doc.value?.encounter || null, (encounterId) => encountersApi.fetch(encounterId))
const encounter = followed.doc
// And the saved values of its characters, one live document each.
const characters = useCharacters(() => (encounter.value?.combatants || []).filter((c) => c.type === 'character').map((c) => c.sheet))
// Its combatants are played from here as from the encounter's tracker: the
// same commands, sent to the encounter (its events applied as they return).
const { countersOf, adjust, patch: patchCombatant, addCondition, removeCondition } = useCombatantActions({
  encounterId: () => doc.value.encounter,
  send: (command) => attempt(followed.commit(command)),
  attempt,
  characters
})
const { sheetOf, load: loadSheet } = useCombatantSheets(characters)
// Pings, the pointer and rolls over tokens: everyone's, shown on the map.
const signals = useMapSignals(id, { canSend: () => props.canInteract })

// Each tool says how it is used (BattlemapTools shows it while it is in hand).
const TOOLS = [
  { value: 'select', label: 'Move', icon: 'mdi-cursor-default', key: 'v' },
  { value: 'ruler', label: 'Measure', icon: 'mdi-ruler', key: 'r', hint: 'Drag to measure. Space or a second finger adds a turn, Backspace takes it back.' },
  { value: 'area', label: 'Draw an area', icon: 'mdi-shape-outline', key: 'a', signedIn: true, hint: 'Drag from where the area starts. Pick its shape beside the tool.' },
  // Seen by everyone on the map and on the screen: for the signed in only.
  { value: 'pointer', label: 'Point', icon: 'mdi-laser-pointer', key: 'p', signedIn: true, hint: 'Click to ping, drag for a laser everyone sees.' }
]
const DEFAULT_COLOR = TOKEN_COLORS[0]
const CHARACTER_COLOR = '#34d399'
const AREA_ICONS = Object.fromEntries(AREA_SHAPES.map((s) => [s.value, s.icon]))
const AREA_LABELS = Object.fromEntries(AREA_SHAPES.map((s) => [s.value, s.label]))

const tool = ref('select')
const selectedId = ref(null)
const selectedAreaId = ref(null)
const areaShape = ref('circle')
const adding = ref(false)
const creatingEncounter = ref(false)
// 'main' (everyone, or one of them opened) or 'setup'.
const view = ref('main')
// What the panel has open: { kind: 'combatant' | 'token' | 'area', id }. It
// stays open when the map is clicked (to pan it, to ping), until another is
// opened or Everyone goes back to the list.
const detail = ref(null)
const visibleTools = computed(() => TOOLS.filter((t) => !t.signedIn || props.canInteract))
const { libraryOpen, openLibrary, closeLibrary, onLibrarySelect } = useLibraryPicker((item, target) => {
  if (target === 'map') send(commands.patch(id, { image_url: item.image_url }))
  else if (target === 'token' && openedToken.value) patchToken({ image_url: item.image_url })
})
const encounters = ref([])

// The encounters to choose from, once signed in (the session check may still
// be on its way when the editor opens).
watch(() => props.canInteract, (signedIn) => {
  if (signedIn) encountersApi.fetchAll().then((all) => { encounters.value = all }).catch(() => {})
}, { immediate: true })

const viewTokens = computed(() =>
  (doc.value?.tokens || []).map((token) => ({ ...token, meters: metersFor(token, encounter.value, characters.docs.value) }))
)
const presentCharacters = computed(() => (encounter.value?.combatants || []).filter((c) => c.type === 'character').map((c) => c.sheet))
const combatantOf = (token) => (token?.combatant && encounter.value?.combatants.find((c) => c.id === token.combatant)) || null
const tokenOf = (c) => doc.value?.tokens.find((t) => t.combatant === c.id) || null
// Tokens that stand for no one in the encounter: listed on their own.
const freeTokens = computed(() => (doc.value?.tokens || []).filter((t) => !combatantOf(t)))
const unplaced = computed(() => (encounter.value?.combatants || []).filter((c) => !tokenOf(c)))

const focusId = computed(() => (detail.value?.kind === 'combatant' ? detail.value.id : null))
const focused = computed(() => (focusId.value && encounter.value?.combatants.find((c) => c.id === focusId.value)) || null)
const openedToken = computed(() => {
  const d = detail.value
  if (d?.kind === 'token') return doc.value?.tokens.find((t) => t.id === d.id) || null
  return focused.value ? tokenOf(focused.value) : null
})
const openedArea = computed(() => (detail.value?.kind === 'area' && doc.value?.areas?.find((a) => a.id === detail.value.id)) || null)
// What is open, while it is still there (removed, by anyone: back to the list).
const opened = computed(() => {
  const d = detail.value
  if (d?.kind === 'combatant') return focused.value ? d : null
  if (d?.kind === 'token') return openedToken.value ? d : null
  if (d?.kind === 'area') return openedArea.value ? d : null
  return null
})
// What the panel's eye shows or hides from the screen.
const hideable = computed(() => (opened.value?.kind === 'area' ? openedArea.value : openedToken.value))
const barNames = computed(() => (openedToken.value ? barOptions(openedToken.value, encounter.value, characters.docs.value) : []))

watch(focused, (c) => { if (c) loadSheet(c) }, { immediate: true })

// The counter a row shows: the first one with a maximum (HP, most often).
const leadCounter = (c) => countersOf(c).find((r) => r.max != null) || null
function portraitOf(c) {
  const image = tokenOf(c)?.image_url || c.image_url
  return image ? resolveUrl(image) : null
}

// One thing selected on the map at a time, a token or an area; selecting one
// opens it in the panel (a token, as whoever it stands for).
function selectToken(tokenId) {
  selectedId.value = tokenId
  if (!tokenId) return
  selectedAreaId.value = null
  const combatant = combatantOf(doc.value?.tokens.find((t) => t.id === tokenId))
  detail.value = combatant ? { kind: 'combatant', id: combatant.id } : { kind: 'token', id: tokenId }
  view.value = 'main'
}

function selectArea(areaId) {
  selectedAreaId.value = areaId
  if (!areaId) return
  selectedId.value = null
  detail.value = { kind: 'area', id: areaId }
  view.value = 'main'
}

function focusCombatant(c) {
  detail.value = { kind: 'combatant', id: c.id }
  selectedId.value = tokenOf(c)?.id || null
  selectedAreaId.value = null
}

function closeDetail() {
  detail.value = null
  selectedId.value = null
  selectedAreaId.value = null
}

// A roll from the sheet shows over its roller's token too, for everyone on
// the map.
function onRolled({ combatant, ...roll }) {
  const token = doc.value?.tokens.find((t) => t.combatant === combatant)
  if (token) signals.roll(token.id, roll)
}

const editSheet = (c) => useDocModal(c.type || 'adversary').open(c.sheet)

const patchToken = (fields) => send(commands.patchItem(id, 'tokens', openedToken.value.id, fields))
const patchGrid = (patch) => send(commands.patch(id, { grid: patch }))
const setEncounter = (encounterId) => send(commands.patch(id, { encounter: encounterId || null }))

function toggleHidden() {
  if (opened.value?.kind === 'area') patchArea({ hidden: !openedArea.value.hidden })
  else patchToken({ hidden: !openedToken.value.hidden })
}

// A plain token on a free cell, opened to be named and dressed.
async function addToken() {
  const [{ x, y }] = freeCells(1, doc.value.tokens)
  let event = null
  const added = await attempt((async () => {
    event = await commit(commands.addItems(id, 'tokens', [{ name: 'Token', x, y, size: 1 }]))
  })())
  const created = added && event?.upsert?.tokens?.at(-1)
  if (created) selectToken(created.id)
}

function removeToken() {
  const token = openedToken.value
  if (!window.confirm(`Remove ${token.name || 'this token'} from the map?`)) return
  if (selectedId.value === token.id) selectedId.value = null
  send(commands.removeItem(id, 'tokens', token.id))
}

const placeCombatants = () => place(unplaced.value)

// A token each for some of the encounter's combatants, on free cells.
function place(combatants) {
  if (!combatants.length) return
  const cells = freeCells(combatants.length, doc.value.tokens)
  const items = combatants.map((c, index) => ({
    name: c.name,
    combatant: c.id,
    sheet: c.sheet || null,
    image_url: c.image_url || null,
    color: c.type === 'character' ? CHARACTER_COLOR : null,
    x: cells[index].x,
    y: cells[index].y,
    size: 1
  }))
  return send(commands.addItems(id, 'tokens', items))
}

// Added to the fight from here: into the encounter, then onto the map. The
// encounter's own event says who is new.
async function addToEncounter(combatants) {
  let event = null
  const added = await attempt((async () => {
    event = await followed.commit(encountersApi.commands.addItems(doc.value.encounter, 'combatants', combatants))
  })())
  if (!added) return
  const known = new Set((doc.value.tokens || []).map((t) => t.combatant))
  const fresh = (event?.upsert?.combatants || []).filter((c) => !known.has(c.id))
  await place(fresh)
  if (fresh.length) focusCombatant(fresh[0])
}

const addFromSheet = (sheet, count) => addToEncounter(combatantsFromSheet(sheet, count, encounter.value.combatants))
const addCustom = (name) => addToEncounter([customCombatant(name)])

// An encounter of its own for a map that has none, next to it, ready to be
// filled.
async function createEncounter() {
  creatingEncounter.value = true
  try {
    let created = null
    const made = await attempt((async () => {
      created = await encountersApi.create(doc.value.name, null, folderOf(id))
    })())
    if (!made) return
    encounters.value = [...encounters.value, created]
    if (await setEncounter(created.id)) {
      adding.value = true
      view.value = 'main'
    }
  } finally {
    creatingEncounter.value = false
  }
}

// ── areas ──────────────────────────────────────────────────────────────

async function addArea(area) {
  let event = null
  const added = await attempt((async () => {
    event = await commit(commands.addItems(id, 'areas', [{ ...area, color: AREA_COLORS[0] }]))
  })())
  const created = added && event?.upsert?.areas?.at(-1)
  if (!created) return
  // Laid down: picked up again at once, to move it, size it, turn it.
  tool.value = 'select'
  selectArea(created.id)
}

// Moved by its origin, or resized and turned by its reach handle.
const moveArea = (areaId, fields) => send(commands.patchItem(id, 'areas', areaId, fields))
const patchArea = (fields) => send(commands.patchItem(id, 'areas', openedArea.value.id, fields))

function removeArea() {
  const areaId = openedArea.value.id
  selectedAreaId.value = null
  send(commands.removeItem(id, 'areas', areaId))
}

// The opened token linked to someone else (or to no one): the panel follows
// it, to their sheet or to the bare token.
async function linkCombatant(combatantId) {
  const token = openedToken.value
  const combatant = encounter.value?.combatants.find((c) => c.id === combatantId)
  const linked = await patchToken({ combatant: combatantId || null, sheet: combatant?.sheet || null, bars: [], show_bars: false })
  if (linked) detail.value = combatant ? { kind: 'combatant', id: combatant.id } : { kind: 'token', id: token.id }
}

// One bar in or out, never the whole list, so two people changing the bars
// at once both count. The first one shown turns the bars on, alone.
function toggleBar(name, on) {
  const token = openedToken.value
  if (on && !token.show_bars) return patchToken({ show_bars: true, bars: [name] })
  return send(commands.editList(id, 'tokens', token.id, 'bars', on ? { add: [name] } : { remove: [name] }))
}

// A token moves where it is let go of (while it is dragged, everyone sees
// the path it would take: signals.measure). Moves go out one at a time, the
// newest position of each token: requests in flight together can reach the
// server in any order, and an older one landing after a newer one would put
// the token back where it was a moment ago.
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

const onMove = (tokenId, position) => sendMove(tokenId, position)

// V, R, A and P pick a tool, as the tools' names say; not while typing.
function onKeydown(event) {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || !event.key) return
  if (event.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return
  const picked = visibleTools.value.find((t) => t.key === event.key.toLowerCase())
  if (picked) tool.value = picked.value
}
window.addEventListener('keydown', onKeydown)
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))


// ── the table screen ───────────────────────────────────────────────────
// The modal's header has Send to screen and Go live, as for every document
// (useDocumentScreen). Sending shows the whole map; live, the screen frames
// what this view shows, following it as it is zoomed and panned.

const VIEW_PUSH_MS = 80
const screenLive = ref(false)
const { on: screenSent, flash: flashSent } = useFlash()
let shownView = null // the part of the map in view here: null for all of it
let viewTimer = null
let viewInflight = null
let viewDirty = false

function onView(rect) {
  shownView = rect
  if (screenLive.value) scheduleView()
}

// A pan sends a view on every pointer move: the screen gets the newest one, a
// few times a second, one at a time.
function scheduleView() {
  viewDirty = true
  if (viewTimer || viewInflight) return
  viewTimer = setTimeout(pushView, VIEW_PUSH_MS)
}

async function pushView() {
  viewTimer = null
  if (!screenLive.value || !viewDirty) return
  viewDirty = false
  viewInflight = screenApi.battlemapView(id, shownView)
    .then((res) => {
      // Something else is on the screen now: there is nothing to follow.
      if (res?.status === 'ignored') screenLive.value = false
    })
    .catch(() => {})
  await viewInflight
  viewInflight = null
  if (viewDirty) scheduleView()
}

async function sendToScreen() {
  if (!(await attempt(screenApi.battlemap(id)))) return
  flashSent()
  if (screenLive.value) scheduleView()
}

async function toggleScreenLive() {
  if (screenLive.value) {
    screenLive.value = false
    return
  }
  screenLive.value = true
  if (await attempt(screenApi.battlemap(id))) scheduleView()
  else screenLive.value = false
}

useDocumentScreen({
  live: screenLive,
  sending: screenSent,
  canSend: computed(() => props.canInteract && !!doc.value?.image_url),
  send: sendToScreen,
  toggle: toggleScreenLive,
  liveHint: 'Show the map on the screen, zoomed and panned as you see it'
})
onBeforeUnmount(() => clearTimeout(viewTimer))
</script>

<style scoped>
.editor {
  flex: 1;
  min-height: 0;
  display: flex;
}

.editor-state {
  flex: 1;
}

.stage {
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 0;
}

/* Whether the map is live: changes reach everyone as they are made. */
.stage-status {
  position: absolute;
  top: var(--space-3);
  right: var(--space-3);
  z-index: var(--z-raised);
  display: flex;
  align-items: center;
  min-height: var(--control-sm);
  padding: 0 var(--space-3);
  background: var(--surface-chrome);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-full);
  box-shadow: var(--shadow-md);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.panel {
  flex: none;
  /* A sheet is played in it: as wide as the map can spare. */
  width: clamp(20rem, 26vw, 26rem);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: 0 var(--space-4) var(--space-6);
  overflow-y: auto;
  border-left: 1px solid var(--border-light);
  background: var(--surface-chrome);
}

/* Stays at the top while the panel scrolls: the way back is always in reach. */
.panel-head {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  min-height: 3.5rem;
  margin: 0 calc(-1 * var(--space-4));
  padding: var(--space-2) var(--space-4);
  border-bottom: 1px solid var(--border-light);
  background: var(--bg-primary);
}

.panel-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--text-md);
  font-weight: 600;
  color: var(--text-primary);
}

.back {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  min-height: var(--control-sm);
  margin-left: calc(-1 * var(--space-2));
  padding: 0 var(--space-2) 0 var(--space-1);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  font-size: var(--text-sm);
  font-weight: 500;
  cursor: pointer;
}

.back .mdi {
  font-size: 1.2rem;
}

.back:hover {
  background: var(--hover-tint);
  color: var(--text-primary);
}

.panel-head .back + .panel-title {
  margin-right: auto;
}

.visibility.off {
  color: var(--status-warning);
}

.hint {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--text-muted);
}

/* ── the list ─────────────────────────────────────────────────────────── */

.encounter-cta {
  display: flex;
  gap: var(--space-3);
  padding: var(--space-4);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg);
  background: var(--accent-a08);
  font-size: var(--text-sm);
  color: var(--text-secondary);
}

.encounter-cta > .mdi {
  flex: none;
  font-size: 1.4rem;
  color: var(--accent-soft);
}

.encounter-cta-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
  flex: 1;
}

.encounter-cta-body p {
  margin: 0;
}

.encounter-cta-title {
  font-weight: 600;
  color: var(--text-primary);
}

.encounter-cta-actions {
  display: flex;
  gap: var(--space-2);
  margin-top: var(--space-1);
}

.encounter-cta-actions select {
  flex: 1;
  min-width: 0;
}

.group {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.group + .group {
  padding-top: var(--space-4);
  border-top: 1px solid var(--border-light);
}

.group-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  min-height: var(--control-sm);
}

.group-title {
  margin: 0;
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-primary);
}

.count {
  margin-left: var(--space-1);
  font-weight: 500;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.group-head .active {
  background: var(--accent-a20);
  color: var(--text-primary);
}

.rows {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0 calc(-1 * var(--space-2));
  padding: 0;
  list-style: none;
}

.row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: 2.75rem;
  padding: var(--space-1) var(--space-2);
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  font-size: var(--text-sm);
  text-align: left;
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-out), border-color var(--duration-fast) var(--ease-out);
}

.row:hover {
  background: var(--hover-tint);
  color: var(--text-primary);
}

.row:active {
  transform: scale(0.99);
}

.row.active {
  border-color: var(--accent-a45);
  background: var(--accent-a12);
  color: var(--text-primary);
}

.row.hidden .avatar,
.row.hidden .row-name {
  opacity: 0.6;
}

.row.defeated .row-name {
  text-decoration: line-through;
  color: var(--text-muted);
}

.row.defeated .avatar {
  filter: grayscale(1);
  opacity: 0.6;
}

.avatar {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  overflow: hidden;
  border-radius: var(--radius-full);
  border: 2px solid var(--avatar);
  background: color-mix(in srgb, var(--avatar) 30%, var(--bg-primary));
  color: var(--text-primary);
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
}

.avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* Not on the map: still in the fight, still playable. */
.row.unplaced .avatar {
  border-style: dashed;
}

.avatar--shape {
  border-radius: var(--radius-md);
  border-width: 1px;
  color: var(--avatar);
  background: color-mix(in srgb, var(--avatar) 14%, transparent);
}

.avatar--shape .mdi {
  font-size: 1rem;
}

.avatar--lg {
  width: 2.75rem;
  height: 2.75rem;
  font-size: var(--text-sm);
}

.row-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  line-height: var(--leading-tight);
}

.row-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}

.row-sub {
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.row-flag {
  flex: none;
  color: var(--text-muted);
}

.row-counter {
  flex: none;
  font-size: var(--text-sm);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}

.row-counter small {
  font-size: var(--text-xs);
  font-weight: 400;
  color: var(--text-muted);
}

.area-size {
  font-weight: 500;
  color: var(--text-secondary);
}

.place-all,
.place-one {
  align-self: flex-start;
}

/* ── one of them, opened ──────────────────────────────────────────────── */

.detail-head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.detail-title {
  min-width: 0;
}

.detail-name {
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-display);
  font-size: var(--text-md);
  color: var(--text-primary);
}

.detail-sub {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--text-muted);
}

/* The token of whoever is played: there when wanted, out of the way of the
   sheet otherwise. */
.token-section {
  border-top: 1px solid var(--border-light);
  padding-top: var(--space-3);
}

.token-section summary {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  margin: 0 calc(-1 * var(--space-2));
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-secondary);
  cursor: pointer;
  list-style: none;
}

.token-section summary::-webkit-details-marker {
  display: none;
}

.token-section summary:hover {
  background: var(--hover-tint);
  color: var(--text-primary);
}

.token-section summary .mdi {
  font-size: 1.1rem;
  transition: transform var(--duration-fast) var(--ease-out);
}

.token-section[open] summary .mdi {
  transform: rotate(90deg);
}

.token-section[open] summary {
  margin-bottom: var(--space-3);
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
