<template>
  <div class="sheet-editor">
    <section class="sheet-editor-form" aria-label="Sheet">
      <div v-if="(canEdit && isEmpty) || $slots.actions" class="form-bar">
        <button v-if="canEdit && isEmpty" type="button" class="rk-btn rk-btn--sm" @click="startFromTemplate">
          <span class="mdi mdi-file-document-outline"></span> Start from a template
        </button>
        <span class="form-bar-spacer"></span>
        <slot name="actions"></slot>
      </div>
      <ul v-if="problems.length" class="form-problems" role="alert">
        <li v-for="problem in problems" :key="problem"><span class="mdi mdi-alert-circle-outline"></span>{{ problem }}</li>
      </ul>
      <SheetBuilder
        :id="id"
        :type="type"
        :name="name"
        :model-value="modelValue"
        :can-edit="canEdit"
        @update:model-value="(value) => emit('update:modelValue', value)"
      />
      <p class="form-hint">
        The name is the {{ type }}'s own (rename it in the gallery). Show it in a note with
        <code>{{ type }}:{{ id }}</code>.
      </p>
    </section>

    <section class="sheet-editor-preview" aria-label="Preview">
      <SheetView :sheet="drawn.sheet" :warnings="drawn.warnings" can-interact>
        <template v-if="$slots.counter" #counter="slotProps">
          <slot name="counter" v-bind="slotProps"></slot>
        </template>
      </SheetView>
    </section>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import SheetView from './SheetView.vue'
import SheetBuilder from './SheetBuilder.vue'
import { SHEET_TEMPLATES, sheetFromDoc, sheetProblems } from '@/utils/sheet'

// A character's or an adversary's sheet, built with forms (SheetBuilder)
// beside the sheet it draws. `modelValue` is the sheet as its document keeps
// it (JSON). Saving is the caller's (a Save button: the modal's for an
// adversary, the character editor's own), and so is what a counter shows (the
// `counter` slot).
const props = defineProps({
  type: { type: String, required: true }, // 'character' | 'adversary'
  id: { type: String, required: true },
  name: { type: String, default: '' },
  modelValue: { type: Object, default: () => ({}) },
  canEdit: { type: Boolean, default: false }
})
const emit = defineEmits(['update:modelValue'])

const drawn = computed(() => sheetFromDoc({ id: props.id, name: props.name || props.id, sheet: props.modelValue }, props.type))
const problems = computed(() => sheetProblems(props.modelValue || {}))

const isEmpty = computed(() => {
  const sheet = props.modelValue || {}
  return !sheet.sections?.length && !sheet.subtitle && !sheet.image && !sheet.text && !sheet.tags?.length
})

function startFromTemplate() {
  emit('update:modelValue', structuredClone(SHEET_TEMPLATES[props.type]))
}
</script>

<style scoped>
.sheet-editor {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
  gap: var(--space-4);
  padding: var(--space-4);
  overflow: hidden;
}

.sheet-editor-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-height: 0;
}

.form-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  min-height: 2rem;
}

.form-bar-spacer {
  flex: 1;
}

.form-problems {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin: 0;
  padding: var(--space-2) var(--space-3);
  list-style: none;
  border: 1px solid rgba(248, 113, 113, 0.35);
  border-radius: var(--radius-md);
  color: var(--status-error);
  font-size: var(--text-sm);
}

.form-problems .mdi {
  margin-right: var(--space-1);
}

.form-hint {
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

  /* One scroll, the page's: the builder grows with what it holds. */
  .sheet-editor-form {
    min-height: auto;
  }

  .sheet-editor-form :deep(.sheet-builder) {
    flex: none;
    overflow: visible;
  }

  .sheet-editor-preview {
    overflow: visible;
  }
}
</style>
