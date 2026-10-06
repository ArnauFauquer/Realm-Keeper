<template>
  <div v-if="status === 'loading'" class="live-state" role="status">
    <span class="rk-spinner rk-spinner--lg"></span>
    <span>Loading {{ noun }}...</span>
  </div>
  <div v-else-if="status === 'gone'" class="live-state" role="alert">
    <span class="mdi mdi-file-question-outline"></span>
    <span>This {{ noun }} was moved or deleted. Look for it in the Observatory.</span>
  </div>
  <div v-else-if="status === 'error'" class="live-state live-state--error" role="alert">
    <span class="mdi mdi-alert-circle-outline"></span>
    <span>{{ error }}</span>
  </div>
</template>

<script setup>
// A live document that can't be shown (yet): loading, gone, or failed.
defineProps({
  status: { type: String, required: true },
  error: { type: String, default: null },
  // What it is, as the sentences say it: 'encounter', 'map'.
  noun: { type: String, required: true }
})
</script>

<style scoped>
.live-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  color: var(--text-secondary);
  font-size: var(--text-sm);
}

.live-state--error {
  color: var(--status-error);
}
</style>
