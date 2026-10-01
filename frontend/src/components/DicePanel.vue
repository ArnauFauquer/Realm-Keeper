<template>
  <div v-if="state.isPanelOpen" class="dice-panel-overlay" @click.self="closePanel">
    <div class="dice-panel-card" @click.stop>
      <header class="panel-header">
        <h3>Roll dice</h3>
        <button class="rk-icon-btn rk-icon-btn--sm" title="Clear selection" aria-label="Clear selection" @click="resetCounts">
          <span class="mdi mdi-backspace-outline"></span>
        </button>
      </header>

      <button
        type="button"
        class="duality-toggle"
        :class="{ active: duality }"
        :aria-pressed="duality"
        title="Two d12: same number is a critical, otherwise the higher die decides Hope or Fear"
        @click="duality = !duality"
      >
        <span class="duality-pips" aria-hidden="true">
          <span class="pip pip--hope"></span>
          <span class="pip pip--fear"></span>
        </span>
        <span class="duality-label">Hope &amp; Fear</span>
        <span class="duality-hint">2d12</span>
        <span class="duality-switch" aria-hidden="true"></span>
      </button>

      <div class="die-grid">
        <div
          v-for="d in dieTypes"
          :key="d.sides"
          class="die-row"
          :class="{ active: counts[d.sides] > 0, negative: counts[d.sides] < 0 }"
        >
          <span class="mdi die-icon" :class="d.icon"></span>
          <span class="die-label">{{ d.label }}</span>
          <div v-if="d.sides === 20" class="d20-mode" role="group" aria-label="Advantage or disadvantage">
            <button
              v-for="m in d20Modes"
              :key="m.mode"
              type="button"
              class="d20-mode-btn"
              :class="{ active: d20Mode === m.mode }"
              :aria-pressed="d20Mode === m.mode"
              :title="m.title"
              @click="toggleD20Mode(m.mode)"
            >{{ m.label }}</button>
          </div>
          <div class="stepper">
            <button type="button" :aria-label="`Remove one ${d.label}`" :disabled="counts[d.sides] <= -MAX_COUNT" @click="decrement(d.sides)">-</button>
            <span class="stepper-value">{{ counts[d.sides] }}</span>
            <button type="button" :aria-label="`Add one ${d.label}`" :disabled="counts[d.sides] >= MAX_COUNT" @click="increment(d.sides)">+</button>
          </div>
        </div>
      </div>

      <div class="modifier-row">
        <span>Modifier</span>
        <div class="stepper">
          <button type="button" aria-label="Decrease modifier" @click="modifier--">-</button>
          <span class="stepper-value">{{ modifier > 0 ? '+' : '' }}{{ modifier }}</span>
          <button type="button" aria-label="Increase modifier" @click="modifier++">+</button>
        </div>
      </div>

      <button
        class="roll-btn rk-btn rk-btn--primary rk-btn--block"
        type="button"
        :disabled="!hasSelection || tooManyDice || state.isRolling"
        @click="rollQuickPick"
      >
        <span class="mdi mdi-dice-multiple"></span>
        <template v-if="tooManyDice">Too many dice (max {{ MAX_DICE }})</template>
        <template v-else>Roll {{ quickFormulaPreview }}</template>
      </button>

      <div class="panel-divider">
        <span>or enter a formula</span>
      </div>

      <form class="formula-row" @submit.prevent="rollFormula">
        <input
          v-model="formulaText"
          class="formula-input rk-input"
          type="text"
          placeholder="e.g. 4d8+5"
          aria-label="Dice formula"
          :class="{ invalid: formulaText.trim() && !isFormulaValid }"
        />
        <button type="submit" class="formula-submit rk-icon-btn" aria-label="Roll formula" :disabled="!isFormulaValid || state.isRolling">
          <span class="mdi mdi-send"></span>
        </button>
      </form>
    </div>
  </div>
</template>

<script setup>
import { reactive, ref, computed, watch } from 'vue'
import { useDiceRoller } from '@/composables/useDiceRoller'
import { parseDiceFormula, formatDiceFormula, DUALITY_TOKEN, ADVANTAGE_TOKENS, MAX_DICE } from '@/utils/diceNotation'

const { state, roll, closePanel } = useDiceRoller()

const dieTypes = [
  { sides: 2, label: 'd2', icon: 'mdi-circle-double' },
  { sides: 4, label: 'd4', icon: 'mdi-dice-d4' },
  { sides: 6, label: 'd6', icon: 'mdi-dice-d6' },
  { sides: 8, label: 'd8', icon: 'mdi-dice-d8' },
  { sides: 10, label: 'd10', icon: 'mdi-dice-d10' },
  { sides: 12, label: 'd12', icon: 'mdi-dice-d12' },
  { sides: 20, label: 'd20', icon: 'mdi-dice-d20' },
  { sides: 100, label: 'd100', icon: 'mdi-dice-multiple' }
]

// A negative count subtracts those dice (e.g. 1d20 - 1d4, or a
// disadvantage d6 off a Hope & Fear roll).
const MAX_COUNT = 20

const counts = reactive(Object.fromEntries(dieTypes.map(d => [d.sides, 0])))
const modifier = ref(0)
const duality = ref(false)
const formulaText = ref('')

// Advantage / disadvantage: the single d20 is rolled twice, keeping the
// higher / lower die. Only meaningful for exactly one d20, so changing the
// d20 count drops back to a normal roll.
const d20Modes = [
  { mode: 'high', label: 'Adv', title: 'Advantage: roll two d20, keep the higher' },
  { mode: 'low', label: 'Dis', title: 'Disadvantage: roll two d20, keep the lower' }
]
const d20Mode = ref(null)

function toggleD20Mode(mode) {
  if (d20Mode.value === mode) {
    d20Mode.value = null
    return
  }
  counts[20] = 1
  d20Mode.value = mode
}

watch(() => counts[20], count => {
  if (count !== 1) d20Mode.value = null
})

function increment(sides) {
  if (counts[sides] < MAX_COUNT) counts[sides]++
}
function decrement(sides) {
  if (counts[sides] > -MAX_COUNT) counts[sides]--
}
function resetCounts() {
  dieTypes.forEach(d => { counts[d.sides] = 0 })
  modifier.value = 0
  duality.value = false
  d20Mode.value = null
}

const hasSelection = computed(() => duality.value || dieTypes.some(d => counts[d.sides] !== 0))

function buildQuickFormula() {
  const added = dieTypes.filter(d => counts[d.sides] > 0).map(d =>
    d.sides === 20 && d20Mode.value ? `+${ADVANTAGE_TOKENS[d20Mode.value]}` : `+${counts[d.sides]}d${d.sides}`)
  const subtracted = dieTypes.filter(d => counts[d.sides] < 0).map(d => `${counts[d.sides]}d${d.sides}`)
  let formula = [duality.value ? DUALITY_TOKEN : '', ...added, ...subtracted].join('')
  if (modifier.value !== 0) {
    formula += modifier.value > 0 ? `+${modifier.value}` : `${modifier.value}`
  }
  return formula.replace(/^\+/, '')
}

const quickParsed = computed(() => hasSelection.value ? parseDiceFormula(buildQuickFormula()) : null)
// The panel only builds valid terms, so a selection that doesn't parse is
// one over MAX_DICE.
const tooManyDice = computed(() => hasSelection.value && !quickParsed.value)
const quickFormulaPreview = computed(() => quickParsed.value ? formatDiceFormula(quickParsed.value) : '')

async function rollQuickPick() {
  if (!quickParsed.value) return
  await roll(buildQuickFormula())
}

const isFormulaValid = computed(() => parseDiceFormula(formulaText.value) !== null)

async function rollFormula() {
  if (!isFormulaValid.value) return
  await roll(formulaText.value)
}
</script>

<style scoped>
.dice-panel-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-floating);
  display: flex;
  align-items: flex-end;
  justify-content: flex-end;
  padding: var(--space-6);
  padding-bottom: calc(5.5rem + env(safe-area-inset-bottom, 0px));
}

.dice-panel-card {
  width: 280px;
  max-width: calc(100vw - 2rem);
  max-height: calc(100dvh - 7rem);
  overflow-y: auto;
  background: var(--surface-overlay);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid var(--border-medium);
  border-radius: var(--radius-lg);
  padding: var(--space-4);
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  animation: rk-rise var(--duration-base) var(--ease-out);
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.panel-header h3 {
  font-size: var(--text-md);
  color: var(--text-primary);
}

.die-grid {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.die-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  background: var(--accent-a08);
  border: 1px solid var(--accent-a20);
  border-radius: var(--radius-md);
  padding: 0.35rem var(--space-2);
  transition:
    background-color var(--duration-fast) var(--ease-out),
    border-color var(--duration-fast) var(--ease-out);
}

.die-row.active {
  background: var(--accent-a20);
  border-color: var(--accent-a45);
}

.die-row.negative {
  background: var(--status-error-bg);
  border-color: var(--status-error-border);
}

.die-row.negative .stepper-value {
  color: var(--status-error);
}

/* Hope & Fear colours match the dice themselves (dice/diceTheme.js). */
.duality-toggle {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  padding: 0.45rem var(--space-2);
  border-radius: var(--radius-md);
  border: 1px solid var(--accent-a20);
  background: var(--accent-a08);
  color: var(--text-secondary);
  font-size: var(--text-sm);
  text-align: left;
  cursor: pointer;
  transition:
    background-color var(--duration-fast) var(--ease-out),
    border-color var(--duration-fast) var(--ease-out);
}

.duality-toggle:hover {
  background: var(--accent-a12);
}

.duality-toggle.active {
  color: var(--text-primary);
  border-color: rgba(227, 179, 65, 0.55);
  background: linear-gradient(90deg, rgba(227, 179, 65, 0.16) 0%, rgba(224, 90, 133, 0.16) 100%);
}

.duality-pips {
  display: flex;
  gap: 3px;
}

.pip {
  width: 10px;
  height: 10px;
  border-radius: 3px;
  transform: rotate(45deg);
}

.pip--hope { background: #e3b341; }
.pip--fear { background: #c2335f; }

.duality-label {
  flex: 1;
  font-weight: 600;
}

.duality-hint {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.duality-switch {
  position: relative;
  width: 28px;
  height: 16px;
  border-radius: var(--radius-full);
  background: var(--border-medium);
  transition: background-color var(--duration-fast) var(--ease-out);
}

.duality-switch::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--text-primary);
  transition: transform var(--duration-fast) var(--ease-out);
}

.duality-toggle.active .duality-switch {
  background: #e3b341;
}

.duality-toggle.active .duality-switch::after {
  transform: translateX(12px);
}

.die-icon {
  font-size: 1.1rem;
  color: var(--accent-soft);
}

.die-label {
  font-size: var(--text-sm);
  color: var(--text-secondary);
  flex: 1;
}

.d20-mode {
  display: flex;
  gap: 2px;
}

.d20-mode-btn {
  height: 22px;
  padding: 0 0.4rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-medium);
  background: transparent;
  color: var(--text-muted);
  font-size: var(--text-xs);
  font-weight: 600;
  transition:
    background-color var(--duration-fast) var(--ease-out),
    color var(--duration-fast) var(--ease-out);
}

.d20-mode-btn:hover {
  background: var(--accent-a12);
  color: var(--text-primary);
}

.d20-mode-btn.active {
  background: var(--accent-a45);
  border-color: var(--accent-a45);
  color: var(--text-primary);
}

.stepper {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.stepper button {
  width: 22px;
  height: 22px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-medium);
  background: var(--accent-a12);
  color: var(--text-primary);
  font-size: var(--text-sm);
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  transition:
    background-color var(--duration-fast) var(--ease-out),
    transform var(--duration-fast) var(--ease-out);
}

.stepper button:disabled {
  opacity: 0.35;
  cursor: default;
}

.stepper button:hover:not(:disabled) {
  background: var(--accent-a30);
}

.stepper button:active:not(:disabled) {
  transform: scale(0.92);
}

.stepper-value {
  min-width: 1.4rem;
  text-align: center;
  font-size: var(--text-sm);
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

.modifier-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: var(--text-sm);
  color: var(--text-secondary);
}

.roll-btn {
  font-weight: 600;
  /* Long formulas wrap instead of overflowing the card. */
  white-space: normal;
  overflow-wrap: anywhere;
  min-width: 0;
  line-height: var(--leading-tight);
  padding-block: var(--space-2);
  /* The roll keeps the dice button's gradient; starts on the deeper
     violet so the white label clears AA. */
  background: linear-gradient(135deg, var(--accent-strong) 0%, #6366f1 100%);
  border: none;
}

.roll-btn:hover:not(:disabled) {
  background: linear-gradient(135deg, var(--accent-strong-hover) 0%, #6d70f3 100%);
}

.roll-btn:disabled {
  opacity: 0.4;
}

.panel-divider {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-xs);
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.panel-divider::before,
.panel-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--border-light);
}

.formula-row {
  display: flex;
  gap: var(--space-2);
}

.formula-input {
  flex: 1;
  min-width: 0;
  min-height: var(--control-md);
  font-family: var(--font-mono);
}

.formula-input.invalid,
.formula-input.invalid:focus {
  border-color: var(--status-error);
  box-shadow: 0 0 0 3px var(--status-error-bg);
}

.formula-submit {
  background: var(--accent-a20);
  color: var(--text-primary);
}

.formula-submit:hover:not(:disabled) {
  background: var(--accent-a45);
}

.formula-submit:disabled {
  opacity: 0.35;
}

/* Step aside while any modal is open: every modal renders an .rk-scrim. */
:global(#app:has(.rk-scrim) .dice-panel-overlay) {
  display: none;
}</style>
