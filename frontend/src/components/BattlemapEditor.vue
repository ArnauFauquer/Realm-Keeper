<template>
  <div class="editor">
    <LiveDocumentState v-if="unavailable" class="editor-state" :status="status" :error="error" noun="map" />

    <template v-else-if="doc">
      <div class="stage">
        <div class="toolbars">
        <div class="toolbar">
          <div class="tool-group" role="group" aria-label="Tools">
            <button
              v-for="t in visibleTools"
              :key="t.value"
              type="button"
              class="tool rk-icon-btn"
              :class="{ active: tool === t.value }"
              :aria-pressed="tool === t.value"
              :title="`${t.label} (${t.key.toUpperCase()})`"
              :aria-label="t.label"
              :aria-keyshortcuts="t.key"
              @click="tool = t.value"
            >
              <span class="mdi" :class="t.icon"></span>
            </button>
          </div>
          <template v-if="canInteract">
            <span class="tool-sep" aria-hidden="true"></span>
            <div class="tool-group" role="group" aria-label="Map">
              <button type="button" class="tool rk-icon-btn" title="Add a token" aria-label="Add a token" @click="addToken">
                <span class="mdi mdi-account-plus-outline"></span>
              </button>
              <button type="button" class="tool rk-icon-btn" :class="{ active: onScreen }" :aria-pressed="onScreen" :title="onScreen ? 'Showing on the screen: click to stop' : 'Show on the screen'" :aria-label="onScreen ? 'Stop showing on the screen' : 'Show on the screen'" @click="toggleScreen">
                <span class="mdi mdi-monitor-share"></span>
              </button>
            </div>
          </template>
          <LiveBadge />
        </div>
        <!-- What the area tool draws. -->
        <div v-if="tool === 'area'" class="toolbar" role="group" aria-label="Area shape">
          <button
            v-for="s in AREA_SHAPES"
            :key="s.value"
            type="button"
            class="tool rk-icon-btn"
            :class="{ active: areaShape === s.value }"
            :aria-pressed="areaShape === s.value"
            :title="`${s.label}: drag from where it starts`"
            :aria-label="s.label"
            @click="areaShape = s.value"
          >
            <span class="mdi" :class="s.icon"></span>
          </button>
        </div>
        </div>

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
          @add-area="addArea"
          @open="openToken"
          @ping="signals.ping"
          @point="signals.point"
          @release="signals.release"
          @measure="signals.measure"
        >
          <template #empty-actions>
            <button v-if="canInteract" type="button" class="rk-btn rk-btn--primary" @click="openLibrary('map')">
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

        <!-- Sheet: whoever the selected token stands for, played from here -->
        <div v-if="tab === 'sheet'" class="tab-body">
          <div v-if="!encounter" class="sheet-empty">
            <span class="mdi mdi-card-account-details-outline" aria-hidden="true"></span>
            <p>Attach an encounter to play its sheets here: rolls, counters and conditions, for everyone at once.</p>
            <label class="field">
              <span>Encounter</span>
              <select class="rk-input" :value="doc.encounter || ''" :disabled="!canInteract" @change="setEncounter($event.target.value)">
                <option value="">None</option>
                <option v-for="e in encounters" :key="e.id" :value="e.id">{{ e.id.includes('/') ? e.id : e.name }}</option>
              </select>
            </label>
            <button v-if="canInteract" type="button" class="rk-btn rk-btn--sm" :disabled="creatingEncounter" @click="createEncounter">
              <span class="mdi mdi-plus"></span> New encounter for this map
            </button>
          </div>

          <template v-else>
            <ul v-if="encounter.combatants.length" class="roster" aria-label="Combatants">
              <li v-for="c in encounter.combatants" :key="c.id">
                <button
                  type="button"
                  class="roster-chip"
                  :class="{ active: c.id === focusId, defeated: c.defeated, unplaced: !tokenOf(c) }"
                  :aria-pressed="c.id === focusId"
                  :title="tokenOf(c) ? c.name : `${c.name} (not on the map)`"
                  @click="focusCombatant(c)"
                >
                  <span class="token-dot" :style="{ background: tokenOf(c)?.color || (c.type === 'character' ? CHARACTER_COLOR : DEFAULT_COLOR) }"></span>
                  <span class="roster-name">{{ c.name }}</span>
                </button>
              </li>
            </ul>
            <p v-else class="hint">Nobody is in this encounter yet.</p>

            <div v-if="canInteract" class="sheet-actions" role="group" aria-label="Encounter">
              <button type="button" class="rk-btn rk-btn--sm" :aria-expanded="adding" @click="adding = !adding">
                <span class="mdi" :class="adding ? 'mdi-close' : 'mdi-account-multiple-plus-outline'"></span> {{ adding ? 'Close' : 'Add to the fight' }}
              </button>
              <button v-if="focused && tokenOf(focused)" type="button" class="rk-btn rk-btn--sm" :title="`${focused.name}'s token: image, size, colour`" @click="editToken(tokenOf(focused))">
                <span class="mdi mdi-image-edit-outline"></span> Token
              </button>
            </div>
            <EncounterAddPanel
              v-if="adding && canInteract"
              :present-characters="presentCharacters"
              @add="addFromSheet"
              @add-custom="addCustom"
            />

            <CombatantPlay
              v-if="focused"
              :key="focused.id"
              :combatant="focused"
              :counters="countersOf(focused)"
              :sheet-state="sheetOf(focused)"
              :can-interact="canInteract"
              @adjust="(name, by) => adjust(focused, name, by)"
              @patch="(fields) => patchCombatant(focused, fields)"
              @add-condition="(name) => addCondition(focused, name)"
              @remove-condition="(condition) => removeCondition(focused, condition)"
              @rolled="onRolled"
              @edit-sheet="editSheet(focused)"
            />
            <p v-else-if="selected" class="hint">
              {{ selected.name || 'This token' }} stands for no one.
              <button v-if="canInteract" type="button" class="link-btn" @click="tab = 'tokens'">Link it to a combatant</button>
            </p>
            <p v-else-if="encounter.combatants.length" class="hint">Pick someone above, or double-click a token on the map.</p>
          </template>
        </div>

        <!-- Tokens -->
        <div v-else-if="tab === 'tokens'" class="tab-body">
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
              <button type="button" class="rk-btn rk-btn--sm" :disabled="!canInteract" @click="openLibrary('token')">
                <span class="mdi mdi-folder-multiple-image"></span> {{ selected.image_url ? 'Change image' : 'Choose image' }}
              </button>
              <button v-if="selected.image_url" type="button" class="rk-btn rk-btn--sm" :disabled="!canInteract" @click="patchToken({ image_url: null })">Remove image</button>
            </div>

            <TokenImageEditor
              v-if="selected.image_url"
              :image-url="selected.image_url"
              :scale="selected.image_scale ?? 1"
              :x="selected.image_x ?? 0"
              :y="selected.image_y ?? 0"
              :rotation="selected.rotation ?? 0"
              :color="selected.color"
              :disabled="!canInteract"
              @change="patchToken"
            />

            <label v-if="encounter" class="field">
              <span>Stands for</span>
              <select class="rk-input" :value="selected.combatant || ''" :disabled="!canInteract" @change="linkCombatant($event.target.value)">
                <option value="">No one</option>
                <option v-for="c in encounter.combatants" :key="c.id" :value="c.id">{{ c.name }}</option>
              </select>
            </label>

            <button v-if="focusedOfSelected" type="button" class="rk-btn rk-btn--sm" @click="tab = 'sheet'">
              <span class="mdi mdi-card-account-details-outline"></span> Play {{ focusedOfSelected.name }}'s sheet
            </button>

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

          <div class="areas-head">
            <h3 class="section-title">Areas</h3>
            <button v-if="canInteract" type="button" class="rk-btn rk-btn--sm" :class="{ active: tool === 'area' }" @click="tool = 'area'">
              <span class="mdi mdi-shape-outline"></span> Draw
            </button>
          </div>
          <p v-if="!(doc.areas || []).length" class="hint">Spell reaches, zones, hazards: pick the area tool (A) and drag from where it starts.</p>
          <ul class="token-list">
            <li v-for="a in doc.areas || []" :key="a.id">
              <button type="button" class="token-row" :class="{ active: a.id === selectedAreaId, hidden: a.hidden }" @click="selectArea(a.id)">
                <span class="mdi" :class="AREA_ICONS[a.shape]" :style="{ color: a.color || AREA_COLORS[0] }"></span>
                <span class="token-name">{{ a.label || AREA_LABELS[a.shape] }}</span>
                <span class="area-size">{{ areaMeasure(doc.grid, a) }}</span>
                <span v-if="a.hidden" class="mdi mdi-eye-off-outline" title="Hidden from the screen"></span>
              </button>
            </li>
          </ul>
          <AreaInspector
            v-if="selectedArea"
            :area="selectedArea"
            :grid="doc.grid"
            :disabled="!canInteract"
            @patch="patchArea"
            @remove="removeArea"
          />
        </div>

        <!-- Map -->
        <div v-else class="tab-body">
          <div class="row">
            <button type="button" class="rk-btn rk-btn--sm" :disabled="!canInteract" @click="openLibrary('map')">
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
                <option value="bands">Range bands (by name)</option>
              </select>
            </label>
            <RangeBandsEditor
              v-if="doc.grid.measure === 'bands'"
              :bands="doc.grid.bands || []"
              :unit="doc.grid.unit"
              :disabled="!canInteract"
              @change="(bands) => patchGrid({ bands })"
            />
            <p v-if="doc.grid.measure === 'bands' && doc.grid.snap" class="hint">
              For free movement, turn off <em>Snap tokens to cells</em> above.
            </p>
          </fieldset>
        </div>
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
import ObservatoryModal from './ObservatoryModal.vue'
import { folderOf } from '@/composables/useObservatoryModal'
import { battlemapsApi, encountersApi } from '@/api/docs'
import { AREA_COLORS, TOKEN_COLORS } from '@/utils/palette'
import { useLibraryPicker } from '@/composables/useLibraryPicker'
import { screenApi } from '@/api/screen'
import { useSyncedDocFollowing } from '@/composables/useSyncedDoc'
import { useLiveDocument } from '@/composables/useLiveDocument'
import LiveBadge from './LiveBadge.vue'
import LiveDocumentState from './LiveDocumentState.vue'
import { useCharacters } from '@/composables/useCharacters'
import { barOptions, metersFor } from '@/utils/battlemapMeters'
import { areaMeasure, freeCells } from '@/utils/battlemapGeometry'
import { combatantsFromSheet, customCombatant } from '@/utils/encounter'
import CombatantPlay from './CombatantPlay.vue'
import EncounterAddPanel from './EncounterAddPanel.vue'
import TokenImageEditor from './TokenImageEditor.vue'
import RangeBandsEditor from './RangeBandsEditor.vue'
import AreaInspector, { AREA_SHAPES } from './AreaInspector.vue'
import { useCombatantActions, useCombatantSheets } from '@/composables/useCombatantActions'
import { useMapSignals } from '@/composables/useMapSignals'
import { useDocModal } from '@/composables/useDocModal'

// One battlemap, live: everyone who has it open sees tokens move as they are
// moved, areas laid, rulers measured and its combatants played. Nothing here
// saves; each action is a command (api/docs.js) and the server announces its
// result. What the screen shows is made by the server.
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

const TABS = [{ value: 'sheet', label: 'Sheet' }, { value: 'tokens', label: 'Tokens' }, { value: 'map', label: 'Map' }]
const TOOLS = [
  { value: 'select', label: 'Select and move', icon: 'mdi-cursor-default', key: 'v' },
  { value: 'ruler', label: 'Measure: Space adds a turn', icon: 'mdi-ruler', key: 'r' },
  { value: 'area', label: 'Draw an area', icon: 'mdi-shape-outline', key: 'a', signedIn: true },
  // Seen by everyone on the map and on the screen: for the signed in only.
  { value: 'pointer', label: 'Point: tap to ping, drag for the laser', icon: 'mdi-laser-pointer', key: 'p', signedIn: true }
]
const COLORS = TOKEN_COLORS
const DEFAULT_COLOR = COLORS[0]
const CHARACTER_COLOR = '#34d399'
const AREA_ICONS = Object.fromEntries(AREA_SHAPES.map((s) => [s.value, s.icon]))
const AREA_LABELS = Object.fromEntries(AREA_SHAPES.map((s) => [s.value, s.label]))

const tab = ref('tokens')
const tool = ref('select')
const selectedId = ref(null)
const selectedAreaId = ref(null)
const areaShape = ref('circle')
const adding = ref(false)
const creatingEncounter = ref(false)
// Whose sheet the Sheet tab plays: the selected token's combatant, or one
// picked from the roster (who may not be on the map at all).
const focusId = ref(null)
const visibleTools = computed(() => TOOLS.filter((t) => !t.signedIn || props.canInteract))
const { libraryOpen, openLibrary, closeLibrary, onLibrarySelect } = useLibraryPicker((item, target) => {
  if (target === 'map') send(commands.patch(id, { image_url: item.image_url }))
  else if (target === 'token' && selected.value) patchToken({ image_url: item.image_url })
})
const encounters = ref([])
const onScreen = ref(false)


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
const selectedArea = computed(() => doc.value?.areas?.find((a) => a.id === selectedAreaId.value) || null)
const presentCharacters = computed(() => (encounter.value?.combatants || []).filter((c) => c.type === 'character').map((c) => c.sheet))
const focused = computed(() => encounter.value?.combatants.find((c) => c.id === focusId.value) || null)
const tokenOf = (c) => doc.value?.tokens.find((t) => t.combatant === c.id) || null
// The combatant the selected token stands for, if it is in the encounter.
const focusedOfSelected = computed(() =>
  (selected.value?.combatant && encounter.value?.combatants.find((c) => c.id === selected.value.combatant)) || null
)

// The map opens on its sheets when it has an encounter to play, on its tokens otherwise.
const stopFirstTab = watch(doc, (loaded) => {
  if (!loaded) return
  tab.value = loaded.encounter ? 'sheet' : 'tokens'
  queueMicrotask(() => stopFirstTab())
}, { immediate: true })

// Selecting a token that stands for someone shows their sheet.
watch(selectedId, () => {
  if (focusedOfSelected.value) focusId.value = focusedOfSelected.value.id
})

watch(focused, (c) => { if (c) loadSheet(c) }, { immediate: true })

// One thing selected at a time: a token, or an area.
function selectToken(tokenId) {
  selectedId.value = tokenId
  if (tokenId) selectedAreaId.value = null
}

function selectArea(areaId) {
  selectedAreaId.value = areaId
  if (!areaId) return
  selectedId.value = null
  tab.value = 'tokens'
}

function editToken(token) {
  selectToken(token.id)
  tab.value = 'tokens'
}

function focusCombatant(c) {
  focusId.value = c.id
  const token = tokenOf(c)
  if (token) selectedId.value = token.id
}

// A token double-clicked: whoever it stands for, played; or, standing for no
// one, the token itself.
function openToken(tokenId) {
  selectedId.value = tokenId
  tab.value = focusedOfSelected.value ? 'sheet' : 'tokens'
}

// A roll from the sheet shows over its roller's token too, for everyone on
// the map.
function onRolled({ combatant, ...roll }) {
  const token = doc.value?.tokens.find((t) => t.combatant === combatant)
  if (token) signals.roll(token.id, roll)
}

const editSheet = (c) => useDocModal(c.type || 'adversary').open(c.sheet)

const unplaced = computed(() => {
  const placed = new Set((doc.value?.tokens || []).map((t) => t.combatant).filter(Boolean))
  return (encounter.value?.combatants || []).filter((c) => !placed.has(c.id))
})

const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0)
const clamp = (value, low, high) => Math.min(high, Math.max(low, num(value)))
const positive = (value, fallback) => (num(value) > 0 ? num(value) : fallback)


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

// An encounter of its own for a map that has none, next to it.
async function createEncounter() {
  creatingEncounter.value = true
  try {
    let created = null
    const made = await attempt((async () => {
      created = await encountersApi.create(doc.value.name, null, folderOf(id))
    })())
    if (!made) return
    encounters.value = [...encounters.value, created]
    if (await setEncounter(created.id)) adding.value = true
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
  if (created) selectArea(created.id)
}

const moveArea = (areaId, position) => send(commands.patchItem(id, 'areas', areaId, position))
const patchArea = (fields) => send(commands.patchItem(id, 'areas', selectedAreaId.value, fields))

function removeArea() {
  const areaId = selectedAreaId.value
  selectedAreaId.value = null
  send(commands.removeItem(id, 'areas', areaId))
}

function linkCombatant(combatantId) {
  const combatant = encounter.value?.combatants.find((c) => c.id === combatantId)
  patchToken({ combatant: combatantId || null, sheet: combatant?.sheet || null, bars: [], show_bars: false })
}

// One bar in or out, never the whole list, so two people changing the bars
// at once both count.
const toggleBar = (name, on) =>
  send(commands.editList(id, 'tokens', selected.value.id, 'bars', on ? { add: [name] } : { remove: [name] }))

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

// V, R, A and P pick a tool, as the buttons' titles say; not while typing.
function onKeydown(event) {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || !event.key) return
  if (event.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return
  const picked = visibleTools.value.find((t) => t.key === event.key.toLowerCase())
  if (picked) tool.value = picked.value
}
window.addEventListener('keydown', onKeydown)
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))


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
}

.stage {
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.toolbars {
  position: absolute;
  top: var(--space-3);
  left: var(--space-3);
  z-index: var(--z-raised);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-2);
}

.toolbar {
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

.tool-group {
  display: flex;
  gap: 2px;
}

.tool-sep {
  align-self: stretch;
  width: 1px;
  margin: var(--space-1) var(--space-1);
  background: var(--border-light);
}

.tool.active {
  background: var(--accent-a30);
  color: var(--text-primary);
}

/* LiveBadge's root, from here. */
.live-badge {
  padding-right: var(--space-2);
}

.panel {
  flex: none;
  /* A sheet is played in it: as wide as the map can spare. */
  width: clamp(20rem, 26vw, 26rem);
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

.sheet-empty {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-4);
  border: 1px dashed var(--border-medium);
  border-radius: var(--radius-lg);
  color: var(--text-secondary);
  font-size: var(--text-sm);
}

.sheet-empty > .mdi {
  font-size: 1.6rem;
  color: var(--accent-soft);
}

.sheet-empty p {
  margin: 0;
}

.sheet-empty .field {
  align-self: stretch;
}

/* Who is in the encounter: one chip each, the one being played lit. */
.roster {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  max-height: 7.5rem;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}

.roster-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  max-width: 11rem;
  padding: 2px var(--space-2);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-full);
  background: var(--surface-sunken);
  color: var(--text-secondary);
  font: inherit;
  font-size: var(--text-xs);
  cursor: pointer;
  transition: border-color var(--duration-fast) var(--ease-out), background var(--duration-fast) var(--ease-out);
}

.roster-chip:hover {
  border-color: var(--border-medium);
  color: var(--text-primary);
}

.roster-chip:active {
  transform: scale(0.97);
}

.roster-chip.active {
  border-color: var(--accent);
  background: var(--accent-a12);
  color: var(--text-primary);
}

/* Not on the map: still in the encounter, still playable. */
.roster-chip.unplaced {
  border-style: dashed;
}

.roster-chip.defeated .roster-name {
  text-decoration: line-through;
  opacity: 0.7;
}

.roster-chip .token-dot {
  width: 0.6rem;
  height: 0.6rem;
}

.roster-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sheet-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.areas-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  margin-top: var(--space-2);
}

.section-title {
  margin: 0;
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-secondary);
}

.areas-head .active {
  border-color: var(--accent);
  color: var(--text-primary);
}

.area-size {
  flex: none;
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.link-btn {
  padding: 0;
  border: none;
  background: none;
  color: var(--accent-soft);
  font: inherit;
  text-decoration: underline;
  cursor: pointer;
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
