<template>
  <div class="tags-input" :class="{ 'is-disabled': disabled }" @click="field?.focus()">
    <span v-for="(tag, i) in modelValue" :key="`${i}-${tag}`" class="tags-chip">
      {{ tag }}
      <button
        type="button"
        class="tags-remove"
        :aria-label="`Remove ${tag}`"
        :disabled="disabled"
        @click.stop="remove(i)"
      >
        <span class="mdi mdi-close"></span>
      </button>
    </span>
    <input
      ref="field"
      v-model="pending"
      class="tags-field"
      type="text"
      :aria-label="label"
      :placeholder="modelValue.length ? '' : placeholder"
      :disabled="disabled"
      @keydown.enter.prevent="commit"
      @keydown="onKeydown"
      @blur="commit"
    />
  </div>
</template>

<script setup>
import { ref } from 'vue'

// A list of short labels (a sheet's or an entry's tags): Enter or a comma
// adds what is typed, Backspace on an empty field takes the last one back.
const props = defineProps({
  modelValue: { type: Array, required: true },
  label: { type: String, default: 'Tags' },
  placeholder: { type: String, default: 'Add a tag' },
  disabled: { type: Boolean, default: false }
})
const emit = defineEmits(['update:modelValue'])

const field = ref(null)
const pending = ref('')

function commit() {
  const added = pending.value.split(',').map((tag) => tag.trim()).filter((tag) => tag && !props.modelValue.includes(tag))
  pending.value = ''
  if (added.length) emit('update:modelValue', [...props.modelValue, ...added])
}

function remove(index) {
  emit('update:modelValue', props.modelValue.filter((_, i) => i !== index))
}

function onKeydown(event) {
  if (event.key === ',') {
    event.preventDefault()
    commit()
  } else if (event.key === 'Backspace' && !pending.value && props.modelValue.length) {
    pending.value = props.modelValue[props.modelValue.length - 1]
    remove(props.modelValue.length - 1)
    event.preventDefault()
  }
}
</script>

<style scoped>
.tags-input {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1);
  min-height: var(--control-md);
  padding: 3px var(--space-2);
  border: 1px solid var(--border-medium);
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
  cursor: text;
  transition: border-color var(--duration-fast) var(--ease-out), box-shadow var(--duration-fast) var(--ease-out);
}

.tags-input:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-a20);
}

.tags-input.is-disabled {
  cursor: default;
  opacity: 0.7;
}

.tags-chip {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 0 2px 0 var(--space-2);
  border: 1px solid rgba(168, 168, 200, 0.16);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: var(--text-xs);
  line-height: 1.6;
}

.tags-remove {
  display: inline-flex;
  padding: 0;
  border: none;
  background: none;
  color: var(--text-muted);
  cursor: pointer;
  border-radius: var(--radius-sm);
}

.tags-remove:hover:not(:disabled) {
  color: var(--text-primary);
}

.tags-remove:disabled {
  display: none;
}

.tags-field {
  flex: 1;
  min-width: 6rem;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  font-size: var(--text-sm);
}

.tags-field::placeholder {
  color: var(--text-muted);
}
</style>
