<template>
  <div class="editor-shell">
    <header class="editor-header">
      <h1>{{ creating ? 'New note' : title }}</h1>
      <p class="editor-path">{{ notePath }}</p>
    </header>

    <div class="editor-tabs" role="tablist">
      <button
        type="button"
        role="tab"
        class="editor-tab"
        :class="{ active: editorTab === 'write' }"
        :aria-selected="editorTab === 'write'"
        @click="editorTab = 'write'"
      >Write</button>
      <button
        type="button"
        role="tab"
        class="editor-tab"
        :class="{ active: editorTab === 'preview' }"
        :aria-selected="editorTab === 'preview'"
        @click="editorTab = 'preview'"
      >Preview</button>
    </div>

    <div v-if="editorTab === 'write'" class="editor-toolbar">
      <span class="editor-toolbar-label">Insert</span>
      <SheetRefPicker @pick="insertAtCursor" />
    </div>

    <textarea
      v-if="editorTab === 'write'"
      ref="editorTextarea"
      v-model="draft"
      class="editor-textarea"
      placeholder="# Title

Write your note in Markdown..."
      spellcheck="false"
    ></textarea>
    <!-- Rendered as the saved note will be: callouts, heading ids, diagrams, embeds. -->
    <MarkdownBody v-else class="editor-preview" :html="previewHtml" :page-title="title" />

    <div v-if="conflict" class="rk-alert conflict" role="alert">
      <span class="mdi mdi-source-merge"></span>
      <div class="conflict-body">
        <strong>{{ saveError }}</strong>
        <p>Your changes are still here. Load their version instead, or save yours over it.</p>
        <div class="conflict-actions">
          <button type="button" class="rk-btn rk-btn--sm" :disabled="saving" @click="reloadTheirs">
            <span class="mdi mdi-refresh"></span>
            <span>Reload their version</span>
          </button>
          <button type="button" class="rk-btn rk-btn--sm rk-btn--danger" :disabled="saving" @click="overwrite">
            <span class="mdi mdi-content-save-alert-outline"></span>
            <span>Overwrite</span>
          </button>
        </div>
      </div>
    </div>
    <div v-else-if="saveError" class="rk-alert" role="alert">
      <span class="mdi mdi-alert-circle-outline"></span>
      <span>{{ saveError }}</span>
    </div>

    <div class="editor-actions">
      <button type="button" class="rk-btn rk-btn--ghost" :disabled="saving" @click="$emit('cancel')">Cancel</button>
      <button type="button" class="rk-btn rk-btn--primary" :disabled="saving" @click="submit">
        <span v-if="saving" class="rk-spinner btn-spinner"></span>
        {{ saving ? 'Saving…' : 'Save' }}
      </button>
    </div>
  </div>
</template>

<script setup>
/**
 * The note editor: a markdown textarea with a preview, the sheet picker,
 * and Save. Leaving with unsaved changes (another note, Back, closing the
 * tab) asks first; a save that crosses someone else's is held back (see
 * useNoteDraft) until the user picks whose version stays.
 */
import { computed, nextTick, ref } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'
import SheetRefPicker from './SheetRefPicker.vue'
import MarkdownBody from './MarkdownBody.vue'
import { useNoteDraft } from '@/composables/useNoteDraft'
import { useUnsavedChangesGuard } from '@/composables/useUnsavedChangesGuard'
import { renderNote } from '@/utils/renderNote'

const props = defineProps({
  notePath: { type: String, required: true },
  title: { type: String, default: '' },
  // What the editor opens with: the file as stored (and its sha), or a new note's template.
  content: { type: String, default: '' },
  sha: { type: String, default: null },
  creating: { type: Boolean, default: false }
})

const emit = defineEmits(['saved', 'cancel'])

const { draft, dirty, creating, saving, saveError, conflict, save, reloadTheirs } = useNoteDraft(
  () => props.notePath,
  { content: props.content, sha: props.sha, creating: props.creating }
)

const editorTab = ref('write')
const editorTextarea = ref(null)

// Only rendered while the preview is shown: typing on the Write tab doesn't
// re-render (and re-sanitize) the whole note on every keystroke.
const previewHtml = computed(() => {
  if (editorTab.value !== 'preview') return ''
  if (!draft.value.trim()) return '<p class="preview-empty">Nothing to preview yet.</p>'
  return renderNote(draft.value).html
})

const { confirmDiscard } = useUnsavedChangesGuard(dirty, 'You have unsaved changes to this note. Leave without saving?')
onBeforeRouteLeave(() => confirmDiscard())
// Another note is the same view with a new path; a hash or query change is not leaving.
onBeforeRouteUpdate((to, from) => to.path === from.path || confirmDiscard())

// Puts `snippet` (a sheet's link) into the draft where the cursor is.
function insertAtCursor(snippet) {
  const textarea = editorTextarea.value
  const start = textarea ? textarea.selectionStart : draft.value.length
  const end = textarea ? textarea.selectionEnd : start
  draft.value = draft.value.slice(0, start) + snippet + draft.value.slice(end)
  nextTick(() => {
    if (!textarea) return
    textarea.focus()
    textarea.setSelectionRange(start + snippet.length, start + snippet.length)
  })
}

async function submit() {
  if (await save()) emit('saved')
}

async function overwrite() {
  if (await save({ overwrite: true })) emit('saved')
}
</script>

<style scoped>
/* ── Editor ─────────────────────────────────────────────────── */
.editor-shell {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.editor-header {
  border-bottom: 1px solid var(--border-light);
  padding-bottom: var(--space-4);
}

.editor-header h1 {
  margin: 0 0 var(--space-1) 0;
  font-size: var(--text-2xl);
  color: var(--text-primary);
}

.editor-path {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-sm);
  font-family: var(--font-mono);
}

.editor-tabs {
  display: flex;
  gap: var(--space-1);
  border-bottom: 1px solid var(--border-light);
}

.editor-tab {
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  border-radius: var(--radius-sm) var(--radius-sm) 0 0;
  color: var(--text-secondary);
  padding: var(--space-2) var(--space-4);
  margin-bottom: -1px;
  font-size: var(--text-sm);
  font-weight: 500;
  transition:
    color var(--duration-fast) var(--ease-out),
    border-color var(--duration-fast) var(--ease-out),
    background-color var(--duration-fast) var(--ease-out);
}

.editor-tab:hover {
  color: var(--text-primary);
  background: var(--hover-tint);
}

.editor-tab:active {
  background: var(--accent-a12);
}

.editor-tab.active {
  color: var(--text-primary);
  border-bottom-color: var(--accent);
}

.editor-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.editor-toolbar-label {
  font-size: var(--text-sm);
  color: var(--text-muted);
}

.editor-textarea {
  width: 100%;
  min-height: 50dvh;
  resize: vertical;
  background: var(--surface-sunken);
  border: 1px solid var(--border-medium);
  border-radius: var(--radius-md);
  padding: var(--space-4);
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: var(--text-base);
  line-height: 1.6;
  transition: border-color var(--duration-fast) var(--ease-out), box-shadow var(--duration-fast) var(--ease-out);
}

.editor-textarea::placeholder {
  color: var(--text-muted);
}

.editor-textarea:focus,
.editor-textarea:focus-visible {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-a20);
  border-radius: var(--radius-md);
}

.editor-preview {
  min-height: 50dvh;
  padding: var(--space-4);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
}

.editor-preview :deep(.preview-empty) {
  color: var(--text-muted);
  font-style: italic;
}

.editor-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-3);
}

/* Spinner sits on the solid accent button, so it is drawn in the
   contrast colour instead of the default accent ring. */
.btn-spinner {
  width: 14px;
  height: 14px;
  border-color: color-mix(in srgb, var(--accent-contrast) 30%, transparent);
  border-top-color: var(--accent-contrast);
}

.conflict-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.conflict-body p {
  margin: 0;
  color: var(--text-secondary);
}

.conflict-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-top: var(--space-2);
}

@media (max-width: 768px) {
  .editor-header h1 {
    font-size: var(--text-xl);
  }
}
</style>
