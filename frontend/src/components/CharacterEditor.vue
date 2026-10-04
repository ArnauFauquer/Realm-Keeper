<template>
  <div class="character-editor">
    <div v-if="status === 'loading' || status === 'idle'" class="editor-state" role="status">
      <span class="rk-spinner rk-spinner--lg"></span>
      <span>Loading character...</span>
    </div>
    <div v-else-if="!state" class="editor-state" role="alert">
      <span class="mdi mdi-file-question-outline"></span>
      <span>This character was moved or deleted. Go back to the list to find it.</span>
    </div>

    <SheetEditor v-else v-model="draft" type="character" :id="id" :name="state.name" :can-edit="canInteract">
      <template #actions>
        <span v-if="saveError" class="save-error" role="alert">{{ saveError }}</span>
        <button
          v-if="canInteract"
          type="button"
          class="rk-btn rk-btn--primary rk-btn--sm"
          :disabled="!dirty || saving"
          @click="save"
        >
          <span class="mdi mdi-content-save-outline"></span> {{ saving ? 'Saving…' : dirty ? 'Save' : 'Saved' }}
        </button>
      </template>

      <!-- The counters are the character's own, live: playing them here is
           playing them everywhere it shows. -->
      <template #counter="{ resource: r }">
        <ResourceCounter
          :name="r.name"
          :current="state.resources?.[r.name]?.current ?? r.start ?? r.max"
          :max="state.resources?.[r.name]?.max ?? r.max"
          :min="state.resources?.[r.name]?.min ?? r.min"
          :display="r.style"
          :color="r.color"
          :editable="canInteract && !!state.resources?.[r.name]"
          @adjust="(by) => adjust(r.name, by)"
        />
      </template>
    </SheetEditor>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import SheetEditor from './SheetEditor.vue'
import ResourceCounter from './ResourceCounter.vue'
import { useCharacters } from '@/composables/useCharacters'
import { useUnsavedChangesGuard } from '@/composables/useUnsavedChangesGuard'

// One character: its sheet's YAML beside the sheet, with its counters live.
// A character is a live document (its counters are played as it is edited),
// so its sheet is saved here, with its own button, rather than by the modal.
const props = defineProps({
  characterId: { type: String, required: true },
  canInteract: { type: Boolean, default: false }
})

const id = props.characterId
const characters = useCharacters(() => [id])

const state = computed(() => characters.stateOf(id))
const status = computed(() => characters.statusOf(id))

// What is being typed; it follows the saved sheet while it has no changes of
// its own (someone else saved it, or this just loaded).
const draft = ref('')
const savedSource = computed(() => state.value?.source ?? '')
const dirty = computed(() => !!state.value && draft.value !== savedSource.value)
let following = true
watch(savedSource, (source) => { if (following) draft.value = source }, { immediate: true })
watch(draft, (value) => { following = value === savedSource.value })

const saving = ref(false)
const saveError = ref('')

async function save() {
  saving.value = true
  saveError.value = ''
  try {
    await characters.patch(id, { source: draft.value })
    following = true
  } catch (err) {
    saveError.value = err.response?.data?.detail || err.message
  } finally {
    saving.value = false
  }
}

async function adjust(resource, by) {
  try {
    await characters.adjust(id, resource, by)
  } catch (err) {
    saveError.value = err.response?.data?.detail || err.message
  }
}

useUnsavedChangesGuard(dirty, 'You have unsaved changes to this character\'s sheet. Discard them?')
</script>

<style scoped>
.character-editor {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.editor-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  min-height: 12rem;
  color: var(--text-secondary);
  font-size: var(--text-sm);
}

.save-error {
  font-size: var(--text-xs);
  color: var(--status-error);
}
</style>
