<template>
  <div v-if="error" class="sheet-error" role="alert">
    <div class="sheet-error-head">
      <span class="mdi mdi-alert-circle-outline"></span>
      <strong>This sheet could not be read</strong>
    </div>
    <p class="sheet-error-message">{{ error }}</p>
    <pre class="sheet-source">{{ source }}</pre>
  </div>

  <SheetView v-else :sheet="sheet" :warnings="warnings" :can-interact="canInteract">
    <!-- A character's counters are the saved ones: the same here, in every
         encounter, and on every other note that shows the sheet. -->
    <template v-if="characters" #counter="{ resource: r }">
      <ResourceCounter
        :name="r.name"
        :current="saved(r.name)?.current ?? r.start ?? r.max"
        :max="saved(r.name)?.max ?? r.max"
        :min="saved(r.name)?.min ?? r.min"
        :display="r.style"
        :color="r.color"
        :editable="!!saved(r.name)"
        @adjust="(by) => adjust(r.name, by)"
      />
    </template>

    <template v-if="canInteract" #footer>
      <AddToEncounter :sheet="sheet" :note-id="noteId" />
    </template>
  </SheetView>
</template>

<script setup>
import { computed, watch } from 'vue'
import SheetView from './SheetView.vue'
import ResourceCounter from './ResourceCounter.vue'
import AddToEncounter from './AddToEncounter.vue'
import { parseSheetSource } from '@/utils/sheet'
import { useCharacters } from '@/composables/useCharacters'

// A ```sheet block of a note, drawn. `source` is the block's YAML; the note
// view mounts this into the placeholder its markdown renderer leaves behind.
const props = defineProps({
  source: { type: String, required: true },
  // The note it is written in (part of an adversary's reference).
  noteId: { type: String, default: '' },
  // Signed in: dice rolls, library images, saved counters and encounters are
  // behind login, like the rest of the app (notes themselves are public).
  canInteract: { type: Boolean, default: false }
})

const result = computed(() => {
  try {
    return parseSheetSource(props.source)
  } catch (e) {
    return { error: e.message }
  }
})
const error = computed(() => result.value.error)
const sheet = computed(() => result.value.sheet)
const warnings = computed(() => result.value.warnings || [])

// Only a signed-in reader of a character's sheet follows the saved counters.
const characters = props.canInteract && sheet.value?.type === 'character' ? useCharacters(() => [sheet.value?.id]) : null

const saved = (name) => characters?.stateOf(sheet.value.id)?.resources?.[name] || null

async function adjust(resource, by) {
  try {
    await characters.adjust(sheet.value.id, resource, by)
  } catch (err) {
    console.error('Failed to change a counter:', err)
  }
}

// The first signed-in view of a character creates its saved counters; later
// ones follow what the sheet says since. That happens when the saved values
// arrive and when this sheet's own counters change, not whenever the saved
// values do: two blocks that declare the same id with different counters
// would otherwise keep undoing each other, each change waking the other.
const counterDefinitions = computed(() => JSON.stringify(sheet.value?.resources || {}))

if (characters) {
  watch([() => characters.status.value, counterDefinitions], async ([status]) => {
    if (status !== 'ready' || !sheet.value) return
    try {
      if (characters.stateOf(sheet.value.id)) await characters.reconcile(sheet.value)
      else await characters.ensure(sheet.value)
    } catch (err) {
      console.error('Failed to save the character:', err)
    }
  }, { immediate: true })
}
</script>

<style scoped>
.sheet-error {
  margin: var(--space-4) 0;
  padding: var(--space-4);
  max-width: 46rem;
  border: 1px solid var(--status-error-border);
  border-left: 4px solid var(--status-error);
  border-radius: var(--radius-lg);
  background: var(--status-error-bg);
}

.sheet-error-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--status-error);
}

.sheet-error .sheet-error-message {
  margin: var(--space-1) 0 var(--space-3);
  color: var(--text-primary);
}

.sheet-source {
  margin: 0;
  max-height: 14rem;
  overflow: auto;
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  color: var(--text-secondary);
}
</style>
