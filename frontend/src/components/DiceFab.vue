<template>
  <button
    class="dice-fab"
    :class="{ 'is-open': state.isPanelOpen, 'is-rolling': state.isRolling }"
    :disabled="state.isRolling"
    aria-label="Roll dice"
    title="Roll dice"
    @click="togglePanel"
  >
    <span class="mdi" :class="state.isPanelOpen ? 'mdi-close' : 'mdi-dice-multiple'"></span>
  </button>
</template>

<script setup>
import { useDiceRoller } from '@/composables/useDiceRoller'

const { state, togglePanel } = useDiceRoller()
</script>

<style scoped>
.dice-fab {
  position: fixed;
  bottom: var(--space-6);
  right: var(--space-6);
  z-index: var(--z-modal-nested);
  width: 56px;
  height: 56px;
  border-radius: var(--radius-full);
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, var(--accent) 0%, #6366f1 100%);
  box-shadow: var(--shadow-accent);
  transition:
    transform var(--duration-base) var(--ease-out),
    box-shadow var(--duration-base) var(--ease-out),
    background-color var(--duration-base) var(--ease-out);
}

.dice-fab .mdi {
  font-size: 1.6rem;
  color: var(--accent-contrast);
}

.dice-fab:hover:not(:disabled) {
  transform: scale(1.06);
  box-shadow: 0 0 0 1px var(--accent-a45), 0 8px 24px var(--accent-a45);
}

.dice-fab:active:not(:disabled) {
  transform: scale(0.96);
}

.dice-fab.is-open {
  background: var(--surface-raised-hover);
  box-shadow: 0 0 0 1px var(--border-medium), var(--shadow-md);
}

.dice-fab.is-rolling {
  cursor: default;
  opacity: 0.75;
}

/* Spin conveys the "rolling" state; stops when the roll settles. */
.dice-fab.is-rolling .mdi {
  animation: dice-spin 0.9s linear infinite;
}

@keyframes dice-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

@media (max-width: 768px) {
  .dice-fab {
    bottom: calc(var(--space-4) + env(safe-area-inset-bottom, 0px));
    right: var(--space-4);
  }
}

/* Step aside while any modal is open: every modal renders an .rk-scrim. */
:global(#app:has(.rk-scrim) .dice-fab) {
  display: none;
}</style>
