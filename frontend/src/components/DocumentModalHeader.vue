<template>
  <div class="modal-header">
    <h2>
      <button v-if="view === 'editor'" class="rk-icon-btn" :title="`Back to ${galleryTitle}`" :aria-label="`Back to ${galleryTitle}`" @click="$emit('back')">
        <span class="mdi mdi-arrow-left"></span>
      </button>
      <span class="title-icon mdi" :class="icon" aria-hidden="true"></span>
      <span class="title-text">{{ view === 'editor' && itemTitle ? itemTitle : galleryTitle }}</span>
    </h2>
    <div class="header-actions">
      <button
        v-if="view === 'editor' && canEdit && showSave"
        class="rk-btn rk-btn--primary header-btn"
        :disabled="!hasUnsavedChanges || saving"
        title="Save changes"
        @click="$emit('save')"
      >
        <span class="mdi mdi-content-save"></span>
        <span>{{ saving ? 'Saving...' : (hasUnsavedChanges ? 'Save' : 'Saved') }}</span>
      </button>
      <button
        v-if="view === 'editor' && canEdit && copyText"
        class="rk-btn header-btn"
        title="Copy reference to paste into a note"
        @click="copy(copyText)"
      >
        <span class="mdi" :class="copiedKey ? 'mdi-check' : 'mdi-content-copy'"></span>
        <span>{{ copiedKey ? 'Copied!' : 'Copy' }}</span>
      </button>
      <button
        v-if="view === 'editor' && canEdit"
        class="rk-btn header-btn"
        :disabled="!canSendToScreen || sendingToScreen"
        title="Send to screen"
        @click="$emit('send-to-screen')"
      >
        <span class="mdi mdi-monitor-share"></span>
        <span>{{ sendingToScreen ? 'Sent!' : 'Send to screen' }}</span>
      </button>
      <button class="rk-icon-btn close-btn" aria-label="Close" @click="$emit('close')">
        <span class="mdi mdi-close"></span>
      </button>
    </div>
  </div>
</template>

<script setup>
import { useCopyToClipboard } from '@/composables/useCopyToClipboard'

const { copiedKey, copy } = useCopyToClipboard()

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
  sendingToScreen: { type: Boolean, default: false },
  // Text the editor view's Copy button puts on the clipboard (e.g. a
  // `chart:<id>` embed reference); no button when omitted.
  copyText: { type: String, default: null }
})

defineEmits(['back', 'save', 'send-to-screen', 'close'])
</script>

<style scoped>
.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  min-height: 64px;
  padding: var(--space-3) var(--space-4) var(--space-3) var(--space-5);
  border-bottom: 1px solid var(--border-light);
}

.modal-header h2 {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  margin: 0;
  font-size: var(--text-lg);
  color: var(--text-primary);
}

.modal-header h2 .rk-icon-btn {
  margin-left: calc(-1 * var(--space-2));
}

.title-icon {
  flex-shrink: 0;
  color: var(--accent-hover);
}

.title-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.header-actions {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: var(--space-2);
}

.close-btn {
  margin-left: var(--space-1);
}

@media (max-width: 640px) {
  /* Icon-only actions on phones so the title keeps its room. */
  .header-btn span:not(.mdi) {
    display: none;
  }

  .header-btn {
    padding: 0 var(--space-3);
  }
}
</style>