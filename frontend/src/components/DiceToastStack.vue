<template>
  <div class="dice-toast-stack">
    <transition-group name="dice-toast" tag="div" class="dice-toast-list">
      <div v-for="t in state.toasts" :key="t.id" class="dice-toast">
        <button class="toast-close rk-icon-btn rk-icon-btn--sm" aria-label="Dismiss roll" @click="dismissToast(t.id)">
          <span class="mdi mdi-close"></span>
        </button>
        <div class="toast-formula">
          <span class="mdi mdi-dice-multiple"></span>
          {{ t.formula }}
        </div>
        <div class="toast-breakdown">
          <span v-for="(g, i) in t.groups" :key="i" class="toast-group">
            <span v-if="i > 0" class="toast-sign">{{ g.sign > 0 ? '+' : '-' }}</span>
            <span class="toast-rolls">[{{ g.rolls.join(', ') }}]</span>
          </span>
          <span v-if="t.flatModifier" class="toast-flat">
            {{ t.flatModifier > 0 ? '+' : '' }}{{ t.flatModifier }}
          </span>
        </div>
        <div class="toast-total">{{ t.total }}</div>
      </div>
    </transition-group>
  </div>
</template>

<script setup>
import { useDiceRoller } from '@/composables/useDiceRoller'

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
