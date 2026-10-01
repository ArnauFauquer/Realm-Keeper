<template>
  <div v-if="state.isPanelOpen" class="dice-panel-overlay" @click.self="closePanel">
    <div class="dice-panel-card" @click.stop>
      <header class="panel-header">
        <h3>Roll dice</h3>
        <button class="rk-icon-btn rk-icon-btn--sm" title="Clear selection" aria-label="Clear selection" @click="resetCounts">
          <span class="mdi mdi-backspace-outline"></span>
        </button>
      </header>

      <div class="die-grid">
        <div v-for="d in dieTypes" :key="d.sides" class="die-row" :class="{ active: counts[d.sides] > 0 }">
          <span class="mdi die-icon" :class="d.icon"></span>
          <span class="die-label">{{ d.label }}</span>
          <div class="stepper">
            <button type="button" :aria-label="`Remove one ${d.label}`" :disabled="counts[d.sides] === 0" @click="decrement(d.sides)">-</button>
            <span class="stepper-value">{{ counts[d.sides] }}</span>
            <button type="button" :aria-label="`Add one ${d.label}`" @click="increment(d.sides)">+</button>
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
        :disabled="!hasSelection || state.isRolling"
        @click="rollQuickPick"
      >
        <span class="mdi mdi-dice-multiple"></span>
        Roll {{ quickFormulaPreview }}
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
import { reactive, ref, computed } from 'vue'
import { useDiceRoller } from '@/composables/useDiceRoller'
import { parseDiceFormula } from '@/utils/diceNotation'

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

const counts = reactive(Object.fromEntries(dieTypes.map(d => [d.sides, 0])))
const modifier = ref(0)
const formulaText = ref('')

function increment(sides) {
  if (counts[sides] < 20) counts[sides]++
}
function decrement(sides) {
  if (counts[sides] > 0) counts[sides]--
}
function resetCounts() {
  dieTypes.forEach(d => { counts[d.sides] = 0 })
  modifier.value = 0
}

const hasSelection = computed(() => dieTypes.some(d => counts[d.sides] > 0))

function buildQuickFormula() {
  const parts = dieTypes
    .filter(d => counts[d.sides] > 0)
    .map(d => `${counts[d.sides]}d${d.sides}`)
  let formula = parts.join('+')
  if (modifier.value !== 0) {
    formula += modifier.value > 0 ? `+${modifier.value}` : `${modifier.value}`
  }
  return formula
}

const quickFormulaPreview = computed(() => hasSelection.value ? buildQuickFormula() : '')

async function rollQuickPick() {
  if (!hasSelection.value) return
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

.die-icon {
  font-size: 1.1rem;
  color: var(--accent-soft);
}

.die-label {
  font-size: var(--text-sm);
  color: var(--text-secondary);
  flex: 1;
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
