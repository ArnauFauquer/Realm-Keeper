<template>
  <div class="sheet-editor">
    <section class="sheet-editor-form" aria-label="Sheet">
      <div v-if="(canEdit && isEmpty) || $slots.actions" class="form-bar">
        <div v-if="canEdit && isEmpty" ref="templateMenuRef" class="template-menu" @keydown.esc.stop="closeTemplateMenu">
          <button
            type="button"
            class="rk-btn rk-btn--sm"
            aria-haspopup="menu"
            :aria-expanded="templateMenuOpen"
            @click="templateMenuOpen = !templateMenuOpen"
          >
            <span class="mdi mdi-file-document-outline"></span> Start from a template
            <span class="mdi mdi-chevron-down template-caret" aria-hidden="true"></span>
          </button>
          <div v-if="templateMenuOpen" class="template-menu-list" role="menu" aria-label="Game system">
            <template v-for="(system, i) in SHEET_SYSTEMS" :key="system.id">
              <div v-if="i === 1" class="template-menu-divider" role="separator"></div>
              <button type="button" class="template-menu-item" role="menuitem" @click="startFromTemplate(system.id)">
                <span class="mdi" :class="system.icon" aria-hidden="true"></span>
                <span class="template-menu-text">
                  <span class="template-menu-name">{{ system.name }}</span>
                  <span class="template-menu-hint">{{ system.hint[type] }}</span>
                </span>
              </button>
            </template>
          </div>
        </div>
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
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import SheetView from './SheetView.vue'
import SheetBuilder from './SheetBuilder.vue'
import { sheetFromDoc, sheetProblems } from '@/utils/sheet'
import { SHEET_SYSTEMS, sheetTemplate } from '@/utils/sheetTemplates'

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

// An empty sheet can start from a game system's: the menu lists them.
const templateMenuOpen = ref(false)
const templateMenuRef = ref(null)

function closeTemplateMenu() {
  if (!templateMenuOpen.value) return
  templateMenuOpen.value = false
  templateMenuRef.value?.querySelector('button')?.focus()
}

watch(templateMenuOpen, async (open) => {
  if (!open) return
  await nextTick()
  templateMenuRef.value?.querySelector('[role="menuitem"]')?.focus()
})

function onOutsideClick(event) {
  if (templateMenuOpen.value && !templateMenuRef.value?.contains(event.target)) templateMenuOpen.value = false
}
document.addEventListener('click', onOutsideClick, true)
onBeforeUnmount(() => document.removeEventListener('click', onOutsideClick, true))

function startFromTemplate(systemId) {
  templateMenuOpen.value = false
  emit('update:modelValue', sheetTemplate(systemId, props.type))
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

.template-menu {
  position: relative;
}

.template-caret {
  margin-left: calc(var(--space-1) * -1);
  opacity: 0.8;
}

.template-menu-list {
  position: absolute;
  top: calc(100% + var(--space-1));
  left: 0;
  z-index: 5;
  width: max-content;
  min-width: 16rem;
  max-width: min(22rem, calc(100vw - 2 * var(--space-4)));
  display: flex;
  flex-direction: column;
  padding: var(--space-1);
  background: var(--surface-overlay);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
}

.template-menu-item {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  text-align: left;
}

.template-menu-item:hover,
.template-menu-item:focus-visible {
  background: var(--hover-tint);
}

.template-menu-item > .mdi {
  color: var(--text-secondary);
  font-size: 1.1em;
  line-height: 1.25rem;
}

.template-menu-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.template-menu-name {
  font-size: var(--text-sm);
  line-height: 1.25rem;
}

.template-menu-hint {
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.template-menu-divider {
  height: 1px;
  margin: var(--space-1) var(--space-2);
  background: var(--border-light);
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
