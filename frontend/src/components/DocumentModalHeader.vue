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
      <span v-if="view === 'editor' && saveError" class="save-error" role="alert" :title="saveError">
        <span class="mdi mdi-alert-circle-outline" aria-hidden="true"></span>
        <span class="save-error-text">{{ saveError }}</span>
      </span>
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
        v-if="view === 'editor' && canEdit && liveSupported"
        class="rk-btn header-btn"
        :class="{ 'rk-btn--primary': live }"
        :disabled="!canSendToScreen"
        :aria-pressed="live"
        :title="live ? 'Stop mirroring on the screen' : (liveHint || 'Show your edits on the screen as you make them')"
        @click="$emit('toggle-live')"
      >
        <span class="mdi mdi-broadcast"></span>
        <span>{{ live ? 'Live' : 'Go live' }}</span>
      </button>
      <button
        v-if="view === 'editor' && canEdit && showSendToScreen"
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
  // Why the last save failed; shown beside Save until one works.
  saveError: { type: String, default: null },
  // Documents with nothing to show on the screen hide the button altogether.
  showSendToScreen: { type: Boolean, default: true },
  canSendToScreen: { type: Boolean, default: false },
  sendingToScreen: { type: Boolean, default: false },
  // Documents that can mirror their unsaved edits on the screen as they're made
  // (charts, vistas) show a "Go live" toggle; `live` is whether it's on.
  liveSupported: { type: Boolean, default: false },
  live: { type: Boolean, default: false },
  // What going live does, when it is not mirroring edits (a battlemap: the
  // screen follows your view).
  liveHint: { type: String, default: null },
  // Text the editor view's Copy button puts on the clipboard (e.g. a
  // `chart:<id>` embed reference); no button when omitted.
  copyText: { type: String, default: null }
})

defineEmits(['back', 'save', 'send-to-screen', 'toggle-live', 'close'])
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

.save-error {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  min-width: 0;
  max-width: 22rem;
  font-size: var(--text-xs);
  color: var(--status-error);
}

.save-error-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 640px) {
  /* Icon-only actions on phones so the title keeps its room. */
  .header-btn span:not(.mdi),
  .save-error-text {
    display: none;
  }

  .header-btn {
    padding: 0 var(--space-3);
  }
}
</style>