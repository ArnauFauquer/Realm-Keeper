<template>
  <div class="dice-toast-stack">
    <transition-group name="dice-toast" tag="div" class="dice-toast-list">
      <div v-for="t in state.toasts" :key="t.id" class="dice-toast" :class="toastClasses(t)">
        <button class="toast-close rk-icon-btn rk-icon-btn--sm" aria-label="Dismiss roll" @click="dismissToast(t.id)">
          <span class="mdi mdi-close"></span>
        </button>
        <div v-if="t.label" class="toast-label">{{ t.label }}</div>
        <div class="toast-formula">
          <span class="mdi mdi-dice-multiple"></span>
          {{ t.formula }}
        </div>
        <div class="toast-breakdown">
          <span v-for="(g, i) in t.groups" :key="i" class="toast-group">
            <span v-if="i > 0 || g.sign < 0" class="toast-sign">{{ g.sign > 0 ? '+' : '-' }}</span>
            <span v-if="g.kind" class="toast-rolls" :class="`kind--${g.kind}`">{{ KIND_LABELS[g.kind] }} {{ g.rolls[0] }}</span>
            <span v-else class="toast-rolls">[<template v-for="(v, j) in g.rolls" :key="j"><template v-if="j">, </template><span :class="rollClass(g, j, t.natural) && `nat--${rollClass(g, j, t.natural)}`">{{ v }}</span></template>]</span>
          </span>
          <span v-if="t.flatModifier" class="toast-flat">
            {{ t.flatModifier > 0 ? '+' : '' }}{{ t.flatModifier }}
          </span>
        </div>
        <div class="toast-result">
          <span class="toast-total">{{ t.total }}</span>
          <span v-if="t.duality" class="toast-outcome">{{ DUALITY_OUTCOME_LABELS[t.duality.outcome] }}</span>
          <span v-if="t.natural?.critical" class="toast-outcome outcome--crit">{{ NATURAL_OUTCOME_LABELS.critical }}</span>
          <span v-if="t.natural?.fumble" class="toast-outcome outcome--fumble">{{ NATURAL_OUTCOME_LABELS.fumble }}</span>
        </div>
      </div>
    </transition-group>
  </div>
</template>

<script setup>
import { useDiceRoller } from '@/composables/useDiceRoller'
import { DUALITY_OUTCOME_LABELS, NATURAL_OUTCOME_LABELS, rollClass } from '@/utils/diceNotation'

const KIND_LABELS = { hope: 'Hope', fear: 'Fear' }

function toastClasses(t) {
  return [
    t.duality && `duality--${t.duality.outcome}`,
    t.natural?.critical && 'natural--crit',
    t.natural?.fumble && !t.natural?.critical && 'natural--fumble'
  ]
}

const { state, dismissToast } = useDiceRoller()
</script>

<style scoped>
.dice-toast-stack {
  position: fixed;
  bottom: calc(6.5rem + env(safe-area-inset-bottom, 0px));
  right: var(--space-6);
  z-index: var(--z-toast);
  pointer-events: none;
  max-width: min(320px, calc(100vw - 2rem));
}

.dice-toast-list {
  display: flex;
  flex-direction: column-reverse;
  gap: var(--space-2);
}

.dice-toast {
  pointer-events: auto;
  position: relative;
  background: var(--surface-overlay);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border: 1px solid var(--accent-a45);
  border-radius: var(--radius-lg);
  padding: var(--space-3) var(--space-8) var(--space-3) var(--space-3);
  box-shadow: var(--shadow-lg);
}

.toast-close {
  position: absolute;
  top: var(--space-1);
  right: var(--space-1);
}

.toast-label {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-primary);
  overflow-wrap: anywhere;
}

.toast-formula {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  color: var(--accent-soft);
  margin-bottom: var(--space-1);
}

.toast-breakdown {
  font-size: var(--text-sm);
  color: var(--text-secondary);
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  margin-bottom: var(--space-1);
  font-variant-numeric: tabular-nums;
}

.toast-sign {
  margin-right: 0.2rem;
  color: var(--text-muted);
}

.toast-result {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
}

.toast-total {
  font-family: var(--font-display);
  font-size: 1.4rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
  background: var(--brand-gradient);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

/* Hope & Fear colours match the dice themselves (dice/diceTheme.js). */
.kind--hope { color: #f2c75c; font-weight: 600; }
.kind--fear { color: #f0759b; font-weight: 600; }

.toast-outcome {
  font-size: var(--text-sm);
  font-weight: 700;
  letter-spacing: 0.02em;
}

.duality--hope { border-color: rgba(227, 179, 65, 0.6); }
.duality--hope .toast-outcome { color: #f2c75c; }
.duality--fear { border-color: rgba(224, 90, 133, 0.6); }
.duality--fear .toast-outcome { color: #f0759b; }
.duality--critical { border-color: #f2c75c; box-shadow: 0 0 0 1px #f2c75c, 0 0 24px rgba(242, 199, 92, 0.45), var(--shadow-lg); }
.duality--critical .toast-outcome {
  text-transform: uppercase;
  background: linear-gradient(90deg, #f2c75c 0%, #f0759b 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

/* Natural 20 / natural 1 on a d20. */
.nat--dropped { text-decoration: line-through; opacity: 0.45; }
.nat--crit { color: #f2c75c; font-weight: 700; }
.nat--fumble { color: var(--status-error); font-weight: 700; }
.outcome--crit { color: #f2c75c; text-transform: uppercase; }
.outcome--fumble { color: var(--status-error); text-transform: uppercase; }
.natural--crit { border-color: #f2c75c; box-shadow: 0 0 0 1px #f2c75c, 0 0 24px rgba(242, 199, 92, 0.45), var(--shadow-lg); }
.natural--fumble { border-color: var(--status-error); box-shadow: 0 0 0 1px var(--status-error), 0 0 24px rgba(248, 113, 113, 0.35), var(--shadow-lg); }

.dice-toast-enter-active,
.dice-toast-leave-active {
  transition:
    opacity var(--duration-base) var(--ease-out),
    transform var(--duration-base) var(--ease-out);
}

.dice-toast-enter-from {
  opacity: 0;
  transform: translateY(12px);
}

.dice-toast-leave-to {
  opacity: 0;
  transform: translateX(24px);
}
</style>
