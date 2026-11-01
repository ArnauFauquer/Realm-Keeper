<template>
  <div class="conditions">
    <span v-for="condition in conditions" :key="condition.id" class="condition">
      {{ condition.name }}
      <button v-if="editable" type="button" class="condition-remove" :aria-label="`Remove ${condition.name} from ${name}`" @click="emit('remove', condition)">
        <span class="mdi mdi-close"></span>
      </button>
    </span>
    <input
      v-if="editable"
      class="condition-input"
      placeholder="+ condition"
      maxlength="80"
      :aria-label="`Add a condition to ${name}`"
      @keyup.enter="add"
    />
  </div>
</template>

<script setup>
// A combatant's conditions: free text, the table's own words (nothing here
// knows what "Prone" does). Shown as chips; whoever owns the combatant
// applies `add` (a name) and `remove` (a condition).
defineProps({
  conditions: { type: Array, default: () => [] },
  // Whose they are, for the buttons' labels.
  name: { type: String, default: '' },
  editable: { type: Boolean, default: false }
})

const emit = defineEmits(['add', 'remove'])

function add(event) {
  const value = event.target.value.trim()
  if (!value) return
  event.target.value = ''
  emit('add', value)
}
</script>

<style scoped>
.conditions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1);
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
</style>
