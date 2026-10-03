<template>
  <div class="tracker">
    <div v-if="status === 'loading'" class="tracker-state" role="status">
      <span class="rk-spinner rk-spinner--lg"></span>
      <span>Loading encounter...</span>
    </div>
    <div v-else-if="status === 'gone'" class="tracker-state" role="alert">
      <span class="mdi mdi-file-question-outline"></span>
      <span>This encounter was moved or deleted. Go back to the list to find it.</span>
    </div>
    <div v-else-if="status === 'error'" class="tracker-state tracker-error" role="alert">
      <span class="mdi mdi-alert-circle-outline"></span>
      <span>{{ error }}</span>
    </div>

    <template v-else-if="doc">
      <div class="tracker-bar">
        <div class="round">
          <span class="round-label">Round</span>
          <button type="button" class="rk-icon-btn rk-icon-btn--sm" aria-label="Previous round" :disabled="!canInteract || doc.round <= 0" @click="setRound(doc.round - 1)">
            <span class="mdi mdi-minus"></span>
          </button>
          <span class="round-value">{{ doc.round }}</span>
          <button type="button" class="rk-icon-btn rk-icon-btn--sm" aria-label="Next round" :disabled="!canInteract" @click="setRound(doc.round + 1)">
            <span class="mdi mdi-plus"></span>
          </button>
        </div>
        <button type="button" class="rk-btn rk-btn--primary rk-btn--sm" :disabled="!canInteract || !doc.combatants.length" @click="advanceTurn">
          <span class="mdi mdi-skip-next"></span> Next turn
        </button>
        <button type="button" class="rk-btn rk-btn--sm" :disabled="!canInteract || doc.combatants.length < 2" title="Highest initiative first" @click="sortByInitiative">
          <span class="mdi mdi-sort-numeric-descending"></span> Sort by initiative
        </button>
        <button type="button" class="rk-btn rk-btn--sm" :disabled="!canInteract || (!doc.round && !doc.turn)" @click="resetRounds">
          <span class="mdi mdi-restart"></span> Reset rounds
        </button>
        <span class="bar-spacer"></span>
        <span class="live-badge" :class="`live-badge--${syncStatus}`" :title="liveTitle">
          <span class="mdi mdi-circle-medium"></span>{{ liveLabel }}
        </span>
        <button v-if="canInteract" type="button" class="rk-btn rk-btn--sm" :aria-expanded="adding" @click="adding = !adding">
          <span class="mdi" :class="adding ? 'mdi-close' : 'mdi-plus'"></span> {{ adding ? 'Close' : 'Add' }}
        </button>
      </div>

      <div v-if="actionError" class="rk-alert" role="alert">
        <span class="mdi mdi-alert-circle-outline"></span>
        <span>{{ actionError }}</span>
      </div>

      <EncounterAddPanel
        v-if="adding && canInteract"
        :present-characters="presentCharacters"
        @add="addFromSheet"
        @add-custom="addCustom"
      />

      <p v-if="!doc.combatants.length" class="tracker-empty">
        Nobody is in this encounter yet.<template v-if="canInteract"> Use <strong>Add</strong> to bring in adversaries and characters from their sheets.</template>
      </p>

      <ol class="combatants">
        <li
          v-for="(c, index) in doc.combatants"
          :key="c.id"
          class="combatant"
          :class="{ 'is-turn': doc.turn === c.id, 'is-defeated': c.defeated }"
        >
          <div class="combatant-head">
            <button
              type="button"
              class="turn-marker rk-icon-btn rk-icon-btn--sm"
              :class="{ active: doc.turn === c.id }"
              :disabled="!canInteract"
              :aria-pressed="doc.turn === c.id"
              :aria-label="`It is ${c.name}'s turn`"
              title="Give the turn to this one"
              @click="giveTurn(c)"
            >
              <span class="mdi" :class="doc.turn === c.id ? 'mdi-play-circle' : 'mdi-play-circle-outline'"></span>
            </button>
            <input
              class="name-input"
              :value="c.name"
              :disabled="!canInteract"
              :aria-label="`Name of ${c.name}`"
              @change="patchCombatant(c, { name: $event.target.value.trim() || c.name })"
            />
            <span class="kind" :class="`kind--${c.type}`">{{ c.type }}</span>
            <label class="initiative">
              <span>Init</span>
              <input
                type="number"
                :value="c.initiative ?? ''"
                :disabled="!canInteract"
                :aria-label="`Initiative of ${c.name}`"
                @change="setInitiative(c, $event.target.value)"
              />
            </label>
            <span class="head-actions">
              <button type="button" class="rk-icon-btn rk-icon-btn--sm" :disabled="!canInteract || index === 0" :aria-label="`Move ${c.name} up`" @click="move(index, -1)">
                <span class="mdi mdi-arrow-up"></span>
              </button>
              <button type="button" class="rk-icon-btn rk-icon-btn--sm" :disabled="!canInteract || index === doc.combatants.length - 1" :aria-label="`Move ${c.name} down`" @click="move(index, 1)">
                <span class="mdi mdi-arrow-down"></span>
              </button>
              <button type="button" class="rk-icon-btn rk-icon-btn--sm" :class="{ active: c.defeated }" :disabled="!canInteract" :aria-pressed="!!c.defeated" :title="c.defeated ? 'Back in the fight' : 'Mark as defeated'" @click="patchCombatant(c, { defeated: !c.defeated })">
                <span class="mdi mdi-skull-outline"></span>
              </button>
              <button type="button" class="rk-icon-btn rk-icon-btn--sm danger" :disabled="!canInteract" :aria-label="`Remove ${c.name}`" @click="removeCombatant(c)">
                <span class="mdi mdi-trash-can-outline"></span>
              </button>
            </span>
          </div>

          <div class="counters">
            <ResourceCounter
              v-for="r in countersOf(c)"
              :key="r.name"
              :name="r.name"
              :current="r.current"
              :max="r.max"
              :min="r.min"
              :display="r.style"
              :color="r.color"
              :editable="canInteract"
              @adjust="(by) => adjust(c, r.name, by)"
            />
            <span v-if="c.type === 'character' && !countersOf(c).length" class="counters-note">
              {{ characters.status.value === 'ready' ? 'No saved counters for this character yet.' : 'Loading counters…' }}
            </span>
          </div>

          <div class="conditions">
            <span v-for="condition in c.conditions" :key="condition.id" class="condition">
              {{ condition.name }}
              <button v-if="canInteract" type="button" class="condition-remove" :aria-label="`Remove ${condition.name} from ${c.name}`" @click="removeCondition(c, condition)">
                <span class="mdi mdi-close"></span>
              </button>
            </span>
            <input
              v-if="canInteract"
              class="condition-input"
              placeholder="+ condition"
              :aria-label="`Add a condition to ${c.name}`"
              @keyup.enter="addCondition(c, $event)"
            />
          </div>

          <details class="more" @toggle="(e) => e.target.open && loadSheet(c)">
            <summary>Notes{{ c.notes ? ' ·' : '' }}<template v-if="c.sheet"> and sheet</template></summary>
            <textarea
              class="notes-input rk-input"
              :value="c.notes"
              rows="2"
              :disabled="!canInteract"
              placeholder="Notes about this one…"
              :aria-label="`Notes about ${c.name}`"
              @change="patchCombatant(c, { notes: $event.target.value })"
            ></textarea>
            <template v-if="c.sheet">
              <p v-if="sheets[c.sheet]?.status === 'loading'" class="sheet-note">Loading sheet…</p>
              <p v-else-if="sheets[c.sheet]?.status === 'missing'" class="sheet-note">
                Its sheet is no longer in the vault ({{ c.sheet }}); the counters above still work.
              </p>
              <SheetView v-else-if="sheets[c.sheet]?.sheet" :sheet="sheets[c.sheet].sheet" :can-interact="canInteract" compact />
            </template>
          </details>
        </li>
      </ol>
    </template>
  </div>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import ResourceCounter from './ResourceCounter.vue'
import EncounterAddPanel from './EncounterAddPanel.vue'
import SheetView from './SheetView.vue'
import { encountersApi } from '@/api/docs'
import { fetchSheet } from '@/api/sheets'
import { useSyncedDoc } from '@/composables/useSyncedDoc'
import { useCharacters } from '@/composables/useCharacters'
import { syncStatus } from '@/composables/syncSocket'
import { combatantsFromSheet, customCombatant, idsByInitiative, nextTurn } from '@/utils/encounter'

// One encounter, live: everyone who has it open sees every change as it is
// made. Nothing here saves; each action is a command (api/docs.js) and the
// server announces its result.
const props = defineProps({
  encounterId: { type: String, required: true },
  // Signed in: only then may it be changed.
  canInteract: { type: Boolean, default: false }
})

const id = props.encounterId
const { commands } = encountersApi
const { doc, status, error, commit } = useSyncedDoc('encounter', id, () => encountersApi.fetch(id))
const characters = useCharacters()

const adding = ref(false)
const actionError = ref('')
const sheets = reactive({}) // by ref: { status: 'loading' | 'missing' | 'ready', sheet }

const LIVE = {
  open: ['Live', 'Changes appear for everyone as they are made'],
  connecting: ['Connecting…', 'Waiting for the connection: changes may be late'],
  denied: ['Signed out', 'Sign in again to see changes live'],
  idle: ['Connecting…', '']
}
const liveLabel = computed(() => LIVE[syncStatus.value][0])
const liveTitle = computed(() => LIVE[syncStatus.value][1])

const presentCharacters = computed(() => (doc.value?.combatants || []).filter((c) => c.type === 'character').map((c) => c.sheet))

/** Waits for `work`, and shows what went wrong. True if nothing did. */
async function attempt(work) {
  actionError.value = ''
  try {
    await work
    return true
  } catch (err) {
    actionError.value = err.response?.data?.detail || err.message
    return false
  }
}

/** Runs a command on this encounter: the event it returns is applied at once. */
const send = (command) => attempt(commit(command))

const setRound = (round) => send(commands.patch(id, { round: Math.max(0, round) }))
const resetRounds = () => send(commands.patch(id, { round: 0, turn: null }))
const giveTurn = (c) => send(commands.patch(id, { turn: c.id, round: doc.value.round || 1 }))
const advanceTurn = () => send(commands.patch(id, nextTurn(doc.value.combatants, doc.value.turn, doc.value.round)))
const sortByInitiative = () => send(commands.orderItems(id, 'combatants', idsByInitiative(doc.value.combatants)))

const patchCombatant = (c, patch) => send(commands.patchItem(id, 'combatants', c.id, patch))

function setInitiative(c, text) {
  const value = text === '' ? null : Number(text)
  if (value !== null && !Number.isFinite(value)) return
  patchCombatant(c, { initiative: value })
}

function move(index, by) {
  const ids = doc.value.combatants.map((c) => c.id)
  ;[ids[index], ids[index + by]] = [ids[index + by], ids[index]]
  send(commands.orderItems(id, 'combatants', ids))
}

function removeCombatant(c) {
  if (!window.confirm(`Remove ${c.name} from the encounter?`)) return
  send(commands.removeItem(id, 'combatants', c.id))
}

// An adversary's counters are its own; a character's are the saved ones.
function countersOf(c) {
  const resources = c.type === 'character' ? characters.stateOf(c.sheet)?.resources : c.resources
  return Object.entries(resources || {}).map(([name, state]) => ({ name, ...state }))
}

function adjust(c, resource, by) {
  // (The characters' composable applies its own events.)
  if (c.type === 'character') return attempt(characters.adjust(c.sheet, resource, by))
  return send(commands.adjust(id, 'combatants', c.id, resource, by))
}

let conditionSeq = 0
function addCondition(c, event) {
  const name = event.target.value.trim()
  if (!name) return
  event.target.value = ''
  const condition = { id: `${Date.now().toString(36)}${conditionSeq++}`, name }
  patchCombatant(c, { conditions: [...c.conditions, condition] })
}

const removeCondition = (c, condition) =>
  patchCombatant(c, { conditions: c.conditions.filter((item) => item.id !== condition.id) })

async function addFromSheet(sheet, count) {
  const items = combatantsFromSheet(sheet, count, doc.value.combatants)
  // A character's saved counters have to exist before the encounter can show them.
  if (sheet.type === 'character' && !(await attempt(characters.ensure(sheet)))) return
  await send(commands.addItems(id, 'combatants', items))
}

const addCustom = (name) => send(commands.addItems(id, 'combatants', [customCombatant(name)]))

// A combatant's sheet is fetched when its details are opened, once.
async function loadSheet(c) {
  if (!c.sheet || sheets[c.sheet]) return
  sheets[c.sheet] = { status: 'loading' }
  try {
    const entry = await fetchSheet(c.sheet)
    sheets[c.sheet] = { status: 'ready', sheet: entry.sheet }
  } catch {
    sheets[c.sheet] = { status: 'missing' }
  }
}
</script>

<style scoped>
.tracker {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-5);
}

.tracker-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  min-height: 12rem;
  color: var(--text-secondary);
  font-size: var(--text-sm);
}

.tracker-error {
  color: var(--status-error);
}

.tracker-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
  position: sticky;
  top: calc(-1 * var(--space-5));
  z-index: var(--z-raised);
  margin: calc(-1 * var(--space-5)) calc(-1 * var(--space-5)) 0;
  padding: var(--space-3) var(--space-5);
  background: var(--surface-chrome);
  border-bottom: 1px solid var(--border-light);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.round {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}

.round-label {
  margin-right: var(--space-1);
  font-size: var(--text-sm);
  color: var(--text-muted);
}

.round-value {
  min-width: 2ch;
  text-align: center;
  font-family: var(--font-mono);
  font-size: var(--text-lg);
  font-weight: 700;
  color: var(--text-primary);
}

.bar-spacer {
  flex: 1;
}

.live-badge {
  display: inline-flex;
  align-items: center;
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

.tracker-empty {
  margin: 0;
  padding: var(--space-8) 0;
  text-align: center;
  color: var(--text-secondary);
}

.combatants {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  margin: 0;
  padding: 0;
  list-style: none;
}

.combatant {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  background: var(--surface-raised);
  border: 1px solid var(--border-light);
  border-left: 4px solid var(--accent-a45);
  border-radius: var(--radius-lg);
  transition: border-color var(--duration-fast) var(--ease-out), opacity var(--duration-fast) var(--ease-out);
}

.combatant.is-turn {
  border-color: var(--accent);
  border-left-color: var(--accent);
  box-shadow: var(--shadow-accent);
}

.combatant.is-defeated {
  opacity: 0.55;
}

.combatant.is-defeated .name-input {
  text-decoration: line-through;
}

.combatant-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.turn-marker.active {
  color: var(--accent-hover);
}

.name-input {
  flex: 1;
  min-width: 8rem;
  padding: var(--space-1) var(--space-2);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  font-family: var(--font-display);
  font-size: var(--text-md);
  font-weight: 700;
}

.name-input:hover:not(:disabled),
.name-input:focus {
  border-color: var(--border-medium);
  background: var(--surface-sunken);
}

.kind {
  font-size: var(--text-xs);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--accent-soft);
}

.kind--character {
  color: var(--status-success);
}

.initiative {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.initiative input {
  width: 4rem;
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  background: var(--surface-sunken);
  color: var(--text-primary);
  font: inherit;
  font-family: var(--font-mono);
}

.head-actions {
  display: flex;
  gap: var(--space-1);
}

.head-actions .active {
  color: var(--status-error);
}

.counters {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding-left: var(--space-2);
}

.counters-note {
  font-size: var(--text-sm);
  color: var(--text-muted);
}

.conditions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1);
  padding-left: var(--space-2);
}

.condition {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: 0 var(--space-2);
  border: 1px solid var(--status-warning);
  border-radius: var(--radius-full);
  background: var(--status-warning-bg);
  color: var(--status-warning);
  font-size: var(--text-xs);
  line-height: 1.7;
}

.condition-remove {
  display: inline-flex;
  padding: 0;
  border: none;
  background: none;
  color: inherit;
  cursor: pointer;
}

.condition-input {
  width: 8rem;
  padding: 0 var(--space-2);
  border: 1px dashed var(--border-medium);
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  font-size: var(--text-xs);
  line-height: 1.7;
}

.more {
  padding-left: var(--space-2);
  font-size: var(--text-sm);
  color: var(--text-secondary);
}

.more summary {
  cursor: pointer;
  color: var(--text-muted);
}

.notes-input {
  width: 100%;
  margin-top: var(--space-2);
  resize: vertical;
}

.sheet-note {
  margin: var(--space-2) 0 0;
  color: var(--text-muted);
}

.more :deep(.sheet-card) {
  max-width: none;
  margin: var(--space-2) 0 0;
}
</style>
