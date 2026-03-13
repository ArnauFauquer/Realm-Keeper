<template>
  <input 
    :value="modelValue"
    @input="$emit('update:modelValue', $event.target.value)"
    type="text" 
    placeholder="Search notes..." 
    class="search-input"
  />
</template>

<script setup>
defineProps({
  modelValue: {
    type: String,
    default: ''
  }
})
defineEmits(['update:modelValue'])
</script>

<style scoped>
.search-input {
  width: 100%;
  padding: 0.625rem 0.875rem;
  border: 1px solid var(--border-light);
  border-radius: 8px;
  font-size: 0.9rem;
  background: rgba(26, 27, 58, 0.6);
  color: var(--text-primary);
  transition: all 0.2s ease;
}

.search-input:focus {
  outline: none;
  border-color: var(--interactive-primary);
  background: rgba(31, 32, 69, 0.8);
  box-shadow: 0 0 12px rgba(138, 92, 245, 0.2);
}

.search-input::placeholder {
  color: var(--text-tertiary);
}
</style>
