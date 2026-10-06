<template>
  <input
    ref="input"
    v-model="value"
    class="inline-rename"
    :aria-label="label"
    @click.stop
    @keyup.enter="submit"
    @keyup.esc="cancel"
    @blur="submit"
  />
</template>

<script setup>
import { onMounted, ref } from 'vue'

// Renames something in place (an album, a track): opens focused with the
// current name selected; Enter or clicking away submits the trimmed name, Esc
// cancels. It reports once - Enter or Esc removes it, which blurs it too.
const props = defineProps({
  initial: { type: String, default: '' },
  label: { type: String, required: true }
})
const emit = defineEmits(['submit', 'cancel'])

const input = ref(null)
const value = ref(props.initial)
let done = false

onMounted(() => {
  input.value?.focus()
  input.value?.select()
})

function submit() {
  if (done) return
  done = true
  emit('submit', value.value.trim())
}

function cancel() {
  if (done) return
  done = true
  emit('cancel')
}
</script>

<style scoped>
.inline-rename {
  flex: 1;
  min-width: 0;
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--accent);
  border-radius: var(--radius-sm);
  background: var(--surface-sunken);
  color: var(--text-primary);
  font-size: var(--text-sm);
}

.inline-rename:focus,
.inline-rename:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px var(--accent-a20);
  border-radius: var(--radius-sm);
}
</style>
