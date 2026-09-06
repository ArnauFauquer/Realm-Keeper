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
  bottom: 1.5rem;
  right: 1.5rem;
  z-index: 2100;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #8a5cf5 0%, #6366f1 100%);
  box-shadow: 0 4px 16px rgba(138, 92, 245, 0.4);
  transition: transform 0.25s ease, box-shadow 0.25s ease, background 0.25s ease;
}

.dice-fab .mdi {
  font-size: 1.6rem;
  color: white;
}

.dice-fab:hover:not(:disabled) {
  transform: scale(1.06);
  box-shadow: 0 6px 20px rgba(138, 92, 245, 0.55);
}

.dice-fab.is-open {
  background: rgba(31, 32, 69, 0.95);
}

.dice-fab.is-rolling {
  cursor: default;
  opacity: 0.75;
}

.dice-fab.is-rolling .mdi {
  animation: dice-spin 0.9s linear infinite;
}

@keyframes dice-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

@media (max-width: 768px) {
  .dice-fab {
    bottom: calc(1rem + env(safe-area-inset-bottom, 0px));
    right: 1rem;
  }
}
</style>
