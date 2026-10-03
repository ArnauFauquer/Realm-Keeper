<template>
  <div class="resource-counter" :style="color ? { '--rc-color': color } : null">
    <span class="rc-name">{{ name }}</span>

    <button
      v-if="editable"
      type="button"
      class="rc-step rk-icon-btn rk-icon-btn--sm"
      :aria-label="`Decrease ${name}`"
      :disabled="current <= min"
      @click="emit('adjust', -1)"
    >
      <span class="mdi mdi-minus"></span>
    </button>

    <span v-if="shape === 'pips'" class="rc-pips" role="img" :aria-label="`${name}: ${current} of ${max}`">
      <span v-for="n in max" :key="n" class="rc-pip" :class="{ filled: n <= current }"></span>
    </span>
    <span v-else-if="shape === 'bar'" class="rc-bar" role="img" :aria-label="`${name}: ${current} of ${max}`">
      <span class="rc-bar-fill" :style="{ width: `${fillPercent}%` }"></span>
    </span>

    <span class="rc-value">{{ shape === 'number' || editable ? `${current} / ${max}` : max }}</span>

    <button
      v-if="editable"
      type="button"
      class="rc-step rk-icon-btn rk-icon-btn--sm"
      :aria-label="`Increase ${name}`"
      :disabled="current >= max"
      @click="emit('adjust', 1)"
    >
      <span class="mdi mdi-plus"></span>
    </button>
  </div>
</template>

<script setup>
import { computed } from 'vue'

// One counter of a sheet or a combatant: HP, Stress, Sanity... It only shows
// the value it is given and asks for a change (`adjust`, by ±1); whoever owns
// the value decides how to apply it.
const props = defineProps({
  name: { type: String, required: true },
  current: { type: Number, required: true },
  max: { type: Number, required: true },
  min: { type: Number, default: 0 },
  // 'pips' | 'bar' | 'number'; unset picks pips while there are few enough.
  // (Not called `style`: that name is Vue's own, for inline CSS.)
  display: { type: String, default: null },
  color: { type: String, default: null },
  editable: { type: Boolean, default: false }
})

const emit = defineEmits(['adjust'])

const MAX_PIPS = 12

const shape = computed(() => {
  if (props.display === 'pips' || props.display === 'bar' || props.display === 'number') {
    return props.display === 'pips' && props.max > 24 ? 'bar' : props.display
  }
  return props.max <= MAX_PIPS ? 'pips' : 'bar'
})

const fillPercent = computed(() => {
  const span = props.max - props.min
  return span > 0 ? Math.min(100, Math.max(0, ((props.current - props.min) / span) * 100)) : 0
})
</script>

<style scoped>
.resource-counter {
  --rc-color: var(--accent);
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--control-sm);
}

.rc-name {
  min-width: 4.5em;
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-secondary);
}

.rc-pips {
  display: flex;
  flex: 0 1 auto;
  flex-wrap: wrap;
  gap: 4px;
  min-width: 0;
}

.rc-pip {
  width: 14px;
  height: 14px;
  border-radius: var(--radius-full);
  border: 2px solid var(--rc-color);
  background: transparent;
  transition: background-color var(--duration-fast) var(--ease-out);
}

.rc-pip.filled {
  background: var(--rc-color);
}

.rc-bar {
  flex: 1;
  min-width: 80px;
  max-width: 220px;
  height: 10px;
  border-radius: var(--radius-full);
  border: 1px solid var(--rc-color);
  overflow: hidden;
}

.rc-bar-fill {
  display: block;
  height: 100%;
  background: var(--rc-color);
  transition: width var(--duration-base) var(--ease-out);
}

.rc-value {
  flex: none;
  white-space: nowrap;
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

.rc-step {
  flex: none;
}
</style>
