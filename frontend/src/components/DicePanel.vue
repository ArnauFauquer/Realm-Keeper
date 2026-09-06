<template>
  <div v-if="state.isPanelOpen" class="dice-panel-overlay" @click.self="closePanel">
    <div class="dice-panel-card" @click.stop>
      <header class="panel-header">
        <h3>Roll dice</h3>
        <button class="icon-btn" title="Clear selection" @click="resetCounts">
          <span class="mdi mdi-backspace-outline"></span>
        </button>
      </header>

      <div class="die-grid">
        <div v-for="d in dieTypes" :key="d.sides" class="die-row" :class="{ active: counts[d.sides] > 0 }">
          <span class="mdi die-icon" :class="d.icon"></span>
          <span class="die-label">{{ d.label }}</span>
          <div class="stepper">
            <button type="button" :disabled="counts[d.sides] === 0" @click="decrement(d.sides)">-</button>
            <span class="stepper-value">{{ counts[d.sides] }}</span>
            <button type="button" @click="increment(d.sides)">+</button>
          </div>
        </div>
      </div>

      <div class="modifier-row">
        <span>Modifier</span>
        <div class="stepper">
          <button type="button" @click="modifier--">-</button>
          <span class="stepper-value">{{ modifier > 0 ? '+' : '' }}{{ modifier }}</span>
          <button type="button" @click="modifier++">+</button>
        </div>
      </div>

      <button
        class="roll-btn"
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
          class="formula-input"
          type="text"
          placeholder="e.g. 4d8+5"
          :class="{ invalid: formulaText.trim() && !isFormulaValid }"
        />
        <button type="submit" class="formula-submit" :disabled="!isFormulaValid || state.isRolling">
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
  z-index: 2150;
  display: flex;
  align-items: flex-end;
  justify-content: flex-end;
  padding: 1.5rem;
  padding-bottom: calc(5.5rem + env(safe-area-inset-bottom, 0px));
}

.dice-panel-card {
  width: 280px;
  max-width: calc(100vw - 2rem);
  max-height: calc(100vh - 7rem);
  overflow-y: auto;
  background: rgba(18, 19, 42, 0.97);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(138, 92, 245, 0.4);
  border-radius: 12px;
  padding: 1rem;
  box-shadow: 0 10px 32px rgba(4, 2, 20, 0.55);
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.panel-header h3 {
  font-size: 1rem;
  color: var(--text-primary);
  margin: 0;
}

.icon-btn {
  background: transparent;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 0.25rem;
  border-radius: 6px;
  display: flex;
}

.icon-btn:hover {
  color: var(--text-primary);
  background: rgba(138, 92, 245, 0.15);
}

.die-grid {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.die-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  background: rgba(138, 92, 245, 0.08);
  border: 1px solid rgba(138, 92, 245, 0.2);
  border-radius: 8px;
  padding: 0.35rem 0.5rem;
}

.die-row.active {
  background: rgba(138, 92, 245, 0.22);
  border-color: rgba(138, 92, 245, 0.5);
}

.die-icon {
  font-size: 1.1rem;
  color: #c4b5fd;
}

.die-label {
  font-size: 0.8rem;
  color: var(--text-secondary);
  flex: 1;
}

.stepper {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.stepper button {
  width: 20px;
  height: 20px;
  border-radius: 5px;
  border: 1px solid rgba(138, 92, 245, 0.4);
  background: rgba(138, 92, 245, 0.15);
  color: var(--text-primary);
  cursor: pointer;
  font-size: 0.85rem;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.stepper button:disabled {
  opacity: 0.35;
  cursor: default;
}

.stepper button:hover:not(:disabled) {
  background: rgba(138, 92, 245, 0.35);
}

.stepper-value {
  min-width: 1.4rem;
  text-align: center;
  font-size: 0.85rem;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

.modifier-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.85rem;
  color: var(--text-secondary);
}

.roll-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.6rem;
  border-radius: 8px;
  border: none;
  background: linear-gradient(135deg, #8a5cf5 0%, #6366f1 100%);
  color: white;
  font-weight: 600;
  cursor: pointer;
  transition: transform 0.15s ease, opacity 0.15s ease;
}

.roll-btn:hover:not(:disabled) {
  transform: translateY(-1px);
}

.roll-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.panel-divider {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.72rem;
  color: var(--text-tertiary);
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
  gap: 0.5rem;
}

.formula-input {
  flex: 1;
  min-width: 0;
  background: rgba(12, 13, 29, 0.6);
  border: 1px solid var(--border-light);
  border-radius: 8px;
  padding: 0.5rem 0.65rem;
  color: var(--text-primary);
  font-family: 'SF Mono', 'Monaco', 'Courier New', monospace;
  font-size: 0.85rem;
}

.formula-input:focus {
  outline: none;
  border-color: rgba(138, 92, 245, 0.7);
}

.formula-input.invalid {
  border-color: var(--status-error);
}

.formula-submit {
  width: 38px;
  border-radius: 8px;
  border: none;
  background: rgba(138, 92, 245, 0.25);
  color: var(--text-primary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.formula-submit:hover:not(:disabled) {
  background: rgba(138, 92, 245, 0.45);
}

.formula-submit:disabled {
  opacity: 0.35;
  cursor: default;
}
</style>
