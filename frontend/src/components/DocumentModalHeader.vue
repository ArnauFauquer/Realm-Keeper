<template>
  <div class="modal-header">
    <h2>
      <button v-if="view === 'editor'" class="back-btn" :title="`Back to ${galleryTitle}`" @click="$emit('back')">
        <span class="mdi mdi-arrow-left"></span>
      </button>
      <span class="mdi" :class="icon"></span>
      {{ view === 'editor' && itemTitle ? itemTitle : galleryTitle }}
    </h2>
    <div class="header-actions">
      <button
        v-if="view === 'editor' && canEdit && showSave"
        class="header-btn primary"
        :disabled="!hasUnsavedChanges || saving"
        title="Save changes"
        @click="$emit('save')"
      >
        <span class="mdi mdi-content-save"></span>
        <span>{{ saving ? 'Saving...' : (hasUnsavedChanges ? 'Save' : 'Saved') }}</span>
      </button>
      <button
        v-if="view === 'editor' && canEdit"
        class="header-btn"
        :disabled="!canSendToScreen || sendingToScreen"
        title="Send to screen"
        @click="$emit('send-to-screen')"
      >
        <span class="mdi mdi-monitor-share"></span>
        <span>{{ sendingToScreen ? 'Sent!' : 'Send to screen' }}</span>
      </button>
      <button class="close-btn" @click="$emit('close')">
        <span class="mdi mdi-close"></span>
      </button>
    </div>
  </div>
</template>

<script setup>
defineProps({
  view: { type: String, required: true },
  icon: { type: String, required: true },
  galleryTitle: { type: String, required: true },
  itemTitle: { type: String, default: null },
  canEdit: { type: Boolean, default: false },
  showSave: { type: Boolean, default: true },
  hasUnsavedChanges: { type: Boolean, default: false },
  saving: { type: Boolean, default: false },
  canSendToScreen: { type: Boolean, default: false },
  sendingToScreen: { type: Boolean, default: false }
})

defineEmits(['back', 'save', 'send-to-screen', 'close'])
</script>

<style scoped>
.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1.25rem 1.5rem;
  border-bottom: 1px solid var(--border-light);
}

.modal-header h2 {
  margin: 0;
  font-size: 1.25rem;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.back-btn {
  background: transparent;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 0.25rem;
  border-radius: 4px;
  display: flex;
  align-items: center;
}

.back-btn:hover {
  background: var(--interactive-secondary);
  color: var(--text-primary);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.header-btn {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.5rem 0.9rem;
  border-radius: 8px;
  border: 1px solid var(--border-medium);
  background: var(--interactive-secondary);
  color: var(--text-primary);
  font-size: 0.85rem;
  cursor: pointer;
  transition: all 0.15s ease;
}

.header-btn:hover:not(:disabled) {
  border-color: var(--interactive-primary);
}

.header-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.header-btn.primary:not(:disabled) {
  background: var(--interactive-primary);
  border-color: var(--interactive-primary);
  color: white;
}

.header-btn.primary:not(:disabled):hover {
  background: var(--interactive-primaryHover);
}

.close-btn {
  background: transparent;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 0.25rem;
  border-radius: 4px;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
}

.close-btn:hover {
  background: var(--interactive-secondary);
  color: var(--text-primary);
}

.close-btn .mdi {
  font-size: 1.5rem;
}
</style>
