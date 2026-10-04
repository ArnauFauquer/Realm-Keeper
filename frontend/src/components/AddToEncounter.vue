<template>
  <div class="add-to-encounter">
    <button type="button" class="rk-btn rk-btn--sm" :aria-expanded="open" @click="toggle">
      <span class="mdi mdi-sword-cross"></span> Add to encounter
    </button>

    <div v-if="open" class="add-panel">
      <p v-if="loading" class="add-note">Loading encounters…</p>
      <p v-else-if="loadError" class="add-note add-error" role="alert">{{ loadError }}</p>
      <p v-else-if="!encounters.length" class="add-note">
        There are no encounters yet. Create one from the Encounters tool.
      </p>
      <template v-else>
        <label class="add-field">
          <span>Encounter</span>
          <select v-model="chosen" class="rk-input">
            <option v-for="e in encounters" :key="e.id" :value="e.id">{{ e.id.includes('/') ? e.id : e.name }}</option>
          </select>
        </label>
        <label v-if="sheet.type === 'adversary'" class="add-field add-count">
          <span>How many</span>
          <input v-model.number="count" class="rk-input" type="number" min="1" :max="MAX_COUNT" />
        </label>
        <button type="button" class="rk-btn rk-btn--primary rk-btn--sm" :disabled="adding || !chosen" @click="add">
          {{ adding ? 'Adding…' : 'Add' }}
        </button>
      </template>

      <p v-if="message" class="add-note" :class="{ 'add-error': failed }" role="status">
        {{ message }}
        <button v-if="addedTo" type="button" class="add-open" @click="openEncounter">Open it</button>
      </p>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { encountersApi } from '@/api/docs'
import { useDocModal } from '@/composables/useDocModal'
import { combatantsFromSheet } from '@/utils/encounter'

// A sheet's button for putting it into an encounter: an adversary as one or
// more independent copies, a character as itself (once).
const props = defineProps({
  // The normalized sheet (utils/sheet.js): its id is its document's.
  sheet: { type: Object, required: true }
})

const MAX_COUNT = 20
const encountersModal = useDocModal('encounter')

const open = ref(false)
const loading = ref(false)
const loadError = ref('')
const encounters = ref([])
const chosen = ref('')
const count = ref(1)
const adding = ref(false)
const message = ref('')
const failed = ref(false)
const addedTo = ref('')

async function toggle() {
  open.value = !open.value
  if (!open.value || encounters.value.length) return
  loading.value = true
  loadError.value = ''
  try {
    encounters.value = await encountersApi.fetchAll()
    chosen.value = chosen.value || encounters.value[0]?.id || ''
  } catch (err) {
    loadError.value = err.response?.data?.detail || err.message
  } finally {
    loading.value = false
  }
}

async function add() {
  adding.value = true
  message.value = ''
  failed.value = false
  addedTo.value = ''
  try {
    const entry = { ...props.sheet, ref: props.sheet.id }
    // The encounter as it is now: copies are numbered after the ones already in it.
    const current = await encountersApi.fetch(chosen.value)
    const amount = Math.max(1, Math.min(MAX_COUNT, Math.floor(Number(count.value)) || 1))
    if (entry.type === 'character' && current.combatants.some((c) => c.type === 'character' && c.sheet === entry.ref)) {
      throw new Error(`${entry.name} is already in this encounter`)
    }
    await encountersApi.commands.addItems(chosen.value, 'combatants', combatantsFromSheet(entry, amount, current.combatants))
    addedTo.value = chosen.value
    message.value = entry.type === 'character' ? `${entry.name} added.` : `${amount > 1 ? `${amount} copies` : 'One copy'} added.`
  } catch (err) {
    failed.value = true
    message.value = err.response?.data?.detail || err.message
  } finally {
    adding.value = false
  }
}

function openEncounter() {
  encountersModal.open(addedTo.value)
}
</script>

<style scoped>
.add-to-encounter {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-2);
  padding-top: var(--space-3);
  border-top: 1px solid var(--border-light);
}

.add-panel {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: var(--space-3);
}

.add-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.add-count input {
  width: 5rem;
}

.add-note {
  flex-basis: 100%;
  margin: 0;
  font-size: var(--text-sm);
  color: var(--text-secondary);
}

.add-error {
  color: var(--status-error);
}

.add-open {
  margin-left: var(--space-2);
  padding: 0;
  border: none;
  background: none;
  color: var(--accent-hover);
  font: inherit;
  text-decoration: underline;
  cursor: pointer;
}
</style>
