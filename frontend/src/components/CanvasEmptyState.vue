<template>
  <!-- What a canvas shows instead of its image: none chosen yet, or one that
       couldn't be loaded. The message is the default slot, what to do about
       it the `actions` slot. -->
  <div class="canvas-empty-state" :role="error ? 'alert' : null">
    <span class="mdi" :class="icon" aria-hidden="true"></span>
    <p><slot /></p>
    <slot name="actions" />
  </div>
</template>

<script setup>
defineProps({
  icon: { type: String, default: 'mdi-image-plus' },
  // An image that should be there and isn't: read out when it appears.
  error: { type: Boolean, default: false }
})
</script>

<style scoped>
.canvas-empty-state {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  padding: var(--space-8);
  color: var(--text-secondary);
  text-align: center;
}

.canvas-empty-state p {
  margin: 0;
  max-width: 40ch;
}

.canvas-empty-state > .mdi {
  font-size: 3rem;
  color: var(--text-muted);
}

.canvas-empty-state :deep(.rk-btn) {
  margin-top: var(--space-2);
}
</style>
