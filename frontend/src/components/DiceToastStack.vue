<template>
  <div class="dice-toast-stack">
    <transition-group name="dice-toast" tag="div" class="dice-toast-list">
      <div v-for="t in state.toasts" :key="t.id" class="dice-toast">
        <button class="toast-close" aria-label="Dismiss" @click="dismissToast(t.id)">
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
  right: 1.5rem;
  z-index: 2200;
  pointer-events: none;
  max-width: min(320px, calc(100vw - 2rem));
}

.dice-toast-list {
  display: flex;
  flex-direction: column-reverse;
  gap: 0.6rem;
}

.dice-toast {
  pointer-events: auto;
  position: relative;
  background: rgba(18, 19, 42, 0.96);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(138, 92, 245, 0.45);
  border-radius: 10px;
  padding: 0.7rem 2rem 0.7rem 0.85rem;
  box-shadow: 0 8px 26px rgba(4, 2, 20, 0.5);
}

.toast-close {
  position: absolute;
  top: 0.4rem;
  right: 0.4rem;
  background: transparent;
  border: none;
  color: var(--text-tertiary);
  cursor: pointer;
  display: flex;
  padding: 0.15rem;
  border-radius: 4px;
}

.toast-close:hover {
  color: var(--text-primary);
  background: rgba(138, 92, 245, 0.2);
}

.toast-formula {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-family: 'SF Mono', 'Monaco', 'Courier New', monospace;
  font-size: 0.8rem;
  color: #c4b5fd;
  margin-bottom: 0.3rem;
}

.toast-breakdown {
  font-size: 0.78rem;
  color: var(--text-secondary);
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  margin-bottom: 0.4rem;
}

.toast-sign {
  margin-right: 0.2rem;
  color: var(--text-tertiary);
}

.toast-total {
  font-size: 1.4rem;
  font-weight: 700;
  color: var(--text-primary);
  background: linear-gradient(90deg, #22d3ee 0%, #a78bfa 60%, #f472b6 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.dice-toast-enter-active,
.dice-toast-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
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
