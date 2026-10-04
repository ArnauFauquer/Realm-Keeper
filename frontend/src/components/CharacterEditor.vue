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

    <template v-else>
      <p v-if="sheet === undefined" class="sheet-line muted">Looking for its sheet…</p>
      <p v-else-if="sheet" class="sheet-line">
        <span class="mdi mdi-card-account-details-outline"></span>
        Its sheet is in
        <a :href="noteHref(sheet.note_id)" @click.prevent="openNote(sheet.note_id)">{{ sheet.note_title }}</a>.
      </p>
      <div v-else class="rk-alert orphan" role="status">
        <span class="mdi mdi-account-alert-outline"></span>
        <span>
          No sheet in the vault has the id <code>{{ id }}</code> any more: its note was deleted, or the sheet's id
          changed. These values stay here until you give them to another id or delete them.
        </span>
      </div>

      <section class="counters" aria-label="Saved counters">
        <ResourceCounter
          v-for="r in counters"
          :key="r.name"
          :name="r.name"
          :current="r.current"
          :max="r.max"
          :min="r.min"
          :display="r.style"
          :color="r.color"
          :editable="canInteract"
          @adjust="(by) => adjust(r.name, by)"
        />
        <p v-if="!counters.length" class="muted">Nothing saved for this character yet.</p>
      </section>

      <div v-if="actionError" class="rk-alert" role="alert">
        <span class="mdi mdi-alert-circle-outline"></span>
        <span>{{ actionError }}</span>
      </div>

      <section v-if="canInteract" class="actions">
        <form class="reassign" @submit.prevent="reassign">
          <label for="reassign-id">Give these values to another id</label>
          <div class="reassign-row">
            <input
              id="reassign-id"
              v-model.trim="newId"
              class="rk-input"
              list="unsaved-character-ids"
              placeholder="new-id"
              :pattern="ID_PATTERN"
              autocomplete="off"
            />
            <datalist id="unsaved-character-ids">
              <option v-for="other in unsavedSheets" :key="other.id" :value="other.id">{{ other.name }}</option>
            </datalist>
            <button type="submit" class="rk-btn" :disabled="!validNewId || busy">
              <span class="mdi mdi-account-arrow-right-outline"></span> Move
            </button>
          </div>
          <p class="hint">
            For a sheet whose id changed: its encounters and map tokens follow. The id must be free
            <template v-if="unsavedSheets.length">— the sheets without saved values are suggested</template>.
          </p>
        </form>

        <button type="button" class="rk-btn danger" :disabled="busy" @click="remove">
          <span class="mdi mdi-trash-can-outline"></span> Delete saved values
        </button>
      </section>
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import ResourceCounter from './ResourceCounter.vue'
import { charactersApi } from '@/api/docs'
import { fetchSheet, fetchSheets } from '@/api/sheets'
import { useCharacters } from '@/composables/useCharacters'

// One saved character: its counters, whether its sheet is still in the vault,
// and what to do with it if not (give its values to another id, or delete it).
const props = defineProps({
  characterId: { type: String, required: true },
  canInteract: { type: Boolean, default: false }
})
const emit = defineEmits(['gone', 'close'])

const ID_PATTERN = '[a-z0-9]+(-[a-z0-9]+)*'
const id = props.characterId
const router = useRouter()
const characters = useCharacters(() => [id])

const state = computed(() => characters.stateOf(id))
const status = computed(() => characters.statusOf(id))
const counters = computed(() => Object.entries(state.value?.resources || {}).map(([name, counter]) => ({ name, ...counter })))

const sheet = ref(undefined) // undefined: looking; null: none in the vault
const unsavedSheets = ref([])
const newId = ref('')
const busy = ref(false)
const actionError = ref('')
const validNewId = computed(() => new RegExp(`^${ID_PATTERN}$`).test(newId.value) && newId.value !== id)

onMounted(async () => {
  try {
    sheet.value = (await fetchSheet(id)) || null
  } catch {
    sheet.value = null
  }
  if (!props.canInteract) return
  try {
    const [sheets, saved] = await Promise.all([fetchSheets(), charactersApi.fetchAll()])
    const savedIds = new Set(saved.map((c) => c.id))
    unsavedSheets.value = sheets.filter((s) => s.type === 'character' && !savedIds.has(s.id))
  } catch {
    // Only the suggestions are missing.
  }
})

async function attempt(work) {
  actionError.value = ''
  busy.value = true
  try {
    return await work()
  } catch (err) {
    actionError.value = err.response?.data?.detail || err.message
    return null
  } finally {
    busy.value = false
  }
}

const adjust = (resource, by) => attempt(() => characters.adjust(id, resource, by))

async function reassign() {
  const done = await attempt(() => charactersApi.reassign(id, newId.value))
  if (done) emit('gone')
}

async function remove() {
  if (!window.confirm(`Delete the saved values of "${state.value.name || id}"? This cannot be undone.`)) return
  const done = await attempt(() => charactersApi.remove(id))
  if (done) emit('gone')
}

const noteHref = (noteId) => `/note/${noteId.split('/').map(encodeURIComponent).join('/')}`

function openNote(noteId) {
  emit('close')
  router.push(noteHref(noteId))
}
</script>

<style scoped>
.character-editor {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  max-width: 46rem;
  padding: var(--space-5);
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

.sheet-line {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
  color: var(--text-secondary);
}

.muted {
  color: var(--text-muted);
}

.counters {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.actions {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-4);
  padding-top: var(--space-4);
  border-top: 1px solid var(--border-light);
}

.reassign {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  width: 100%;
}

.reassign label {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-primary);
}

.reassign-row {
  display: flex;
  gap: var(--space-2);
}

.reassign-row .rk-input {
  flex: 1;
  max-width: 20rem;
  font-family: var(--font-mono);
}

.hint {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.danger {
  color: var(--status-error);
}
</style>
