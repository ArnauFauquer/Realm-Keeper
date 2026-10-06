<template>
  <div class="sheet-editor">
    <section class="sheet-editor-source" aria-label="Sheet YAML">
      <div class="source-bar">
        <span class="source-label">YAML</span>
        <span v-if="parsed.error" class="source-status error" role="status">
          <span class="mdi mdi-alert-circle-outline"></span> Not valid yet
        </span>
        <span v-else class="source-status ok"><span class="mdi mdi-check"></span> Valid</span>
        <button v-if="canEdit && !modelValue.trim()" type="button" class="rk-btn rk-btn--sm" @click="startFromTemplate">
          <span class="mdi mdi-file-document-outline"></span> Start from a template
        </button>
        <slot name="actions"></slot>
      </div>
      <textarea
        class="source-input"
        :value="modelValue"
        :readonly="!canEdit"
        spellcheck="false"
        autocomplete="off"
        :aria-label="`${name} sheet YAML`"
        :placeholder="`subtitle: …\nsections:\n  - counters:\n      HP: 6`"
        @input="onInput"
        @keydown.tab.prevent="indent"
      ></textarea>
      <p v-if="parsed.error" class="source-error" role="alert">{{ parsed.error }}</p>
      <p class="source-hint">
        The name is the {{ type }}'s own (rename it in the gallery). Show it in a note with
        <code>{{ type }}:{{ id }}</code>.
      </p>
    </section>

    <section class="sheet-editor-preview" aria-label="Preview">
      <SheetView v-if="lastValid" :sheet="lastValid.sheet" :warnings="lastValid.warnings" can-interact>
        <template v-if="$slots.counter" #counter="slotProps">
          <slot name="counter" v-bind="slotProps"></slot>
        </template>
      </SheetView>
    </section>
  </div>
</template>

<script setup>
import { onBeforeUnmount, ref, watch } from 'vue'
import SheetView from './SheetView.vue'
import { SHEET_TEMPLATES, parseSheetSource } from '@/utils/sheet'

// A character's or an adversary's sheet, edited: its YAML beside the sheet it
// draws. The preview keeps the last valid sheet while the YAML is half typed.
// Saving is the caller's (a Save button: the modal's for an adversary, the
// character editor's own), and so is what a counter shows (the `counter` slot).
const props = defineProps({
  type: { type: String, required: true }, // 'character' | 'adversary'
  id: { type: String, required: true },
  name: { type: String, default: '' },
  modelValue: { type: String, default: '' },
  canEdit: { type: Boolean, default: false }
})
const emit = defineEmits(['update:modelValue'])

function parse() {
  try {
    return parseSheetSource(props.modelValue, { name: props.name || props.id, id: props.id, type: props.type })
  } catch (e) {
    return { error: e.message }
  }
}

// Parsed once typing pauses (PARSE_DELAY ms), not at every keystroke: a long
// sheet takes a moment to read and draw. Anything else (it loaded, a
// template, someone saved it) is parsed at once.
const PARSE_DELAY = 150
const parsed = ref(parse())
const lastValid = ref(null)
let typing = false
let timer = null

watch(() => [props.modelValue, props.name, props.id, props.type], () => {
  clearTimeout(timer)
  if (!typing) {
    parsed.value = parse()
    return
  }
  typing = false
  timer = setTimeout(() => { parsed.value = parse() }, PARSE_DELAY)
})
watch(parsed, (result) => { if (!result.error) lastValid.value = result }, { immediate: true })
onBeforeUnmount(() => clearTimeout(timer))

function onInput(event) {
  typing = true
  emit('update:modelValue', event.target.value)
}

function startFromTemplate() {
  emit('update:modelValue', SHEET_TEMPLATES[props.type])
}

// Tab indents (two spaces, as YAML wants) instead of leaving the field.
function indent(event) {
  const field = event.target
  const { selectionStart: start, selectionEnd: end, value } = field
  emit('update:modelValue', `${value.slice(0, start)}  ${value.slice(end)}`)
  requestAnimationFrame(() => field.setSelectionRange(start + 2, start + 2))
}
</script>

<style scoped>
.sheet-editor {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr);
  gap: var(--space-4);
  padding: var(--space-4);
  overflow: hidden;
}

.sheet-editor-source {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-height: 0;
}

.source-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  min-height: 2rem;
}

.source-label {
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.source-status {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--text-xs);
  margin-right: auto;
}

.source-status.ok {
  color: var(--text-muted);
}

.source-status.error {
  color: var(--status-error);
}

.source-input {
  flex: 1;
  min-height: 16rem;
  width: 100%;
  resize: none;
  padding: var(--space-3);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  line-height: 1.5;
  tab-size: 2;
}

.source-input:focus {
  outline: 2px solid var(--accent);
  outline-offset: -1px;
}

.source-error {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--status-error);
}

.source-hint {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.sheet-editor-preview {
  min-height: 0;
  overflow-y: auto;
}

@media (max-width: 900px) {
  .sheet-editor {
    grid-template-columns: minmax(0, 1fr);
    overflow-y: auto;
  }

  .source-input {
    min-height: 20rem;
  }

  .sheet-editor-preview {
    overflow: visible;
  }
}
</style>
