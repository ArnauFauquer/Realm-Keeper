<template>
  <section class="add-panel" aria-label="Add to the encounter">
    <div class="add-controls">
      <input v-model="query" class="rk-input add-search" type="search" placeholder="Search by name, tag or folder…" aria-label="Search sheets" />
      <div class="add-filter" role="group" aria-label="Show">
        <button
          v-for="option in FILTERS"
          :key="option.value"
          type="button"
          class="add-filter-btn"
          :class="{ active: filter === option.value }"
          :aria-pressed="filter === option.value"
          @click="filter = option.value"
        >{{ option.label }}</button>
      </div>
    </div>

    <p v-if="loading" class="add-note">Loading sheets…</p>
    <p v-else-if="loadError" class="add-note add-error" role="alert">{{ loadError }}</p>
    <p v-else-if="!sheets.length" class="add-note">
      No characters or adversaries yet: create them from the sidebar's Characters and Adversaries tools.
    </p>
    <p v-else-if="!shown.length" class="add-note">No sheet matches.</p>

    <ul v-else class="add-list">
      <li v-for="sheet in shown" :key="`${sheet.type}:${sheet.ref}`" class="add-row">
        <div class="add-info">
          <span class="add-name">{{ sheet.name }}</span>
          <span class="add-type" :class="`add-type--${sheet.type}`">{{ sheet.type }}</span>
          <span v-if="sheet.subtitle" class="add-sub">{{ sheet.subtitle }}</span>
          <span v-if="sheet.folder" class="add-sub add-where">{{ sheet.folder }}</span>
          <span class="add-counters">{{ countersText(sheet) }}</span>
        </div>
        <label v-if="sheet.type === 'adversary'" class="add-count">
          <span class="rk-visually-hidden">How many {{ sheet.name }}</span>
          <input v-model.number="counts[sheet.ref]" class="rk-input" type="number" min="1" :max="MAX_COUNT" />
        </label>
        <button
          type="button"
          class="rk-btn rk-btn--sm"
          :disabled="sheet.type === 'character' && present.has(sheet.ref)"
          @click="add(sheet)"
        >
          {{ sheet.type === 'character' && present.has(sheet.ref) ? 'In it' : 'Add' }}
        </button>
      </li>
    </ul>

    <form class="add-custom" @submit.prevent="addCustom">
      <input v-model="customName" class="rk-input" placeholder="Or a name, for someone with no sheet" aria-label="Name of someone with no sheet" />
      <button type="submit" class="rk-btn rk-btn--sm" :disabled="!customName.trim()">Add</button>
    </form>
  </section>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { fetchSheets } from '@/api/sheets'
import { errorMessage } from '@/api/http'

// The sheet picker of an encounter: search the characters and adversaries and add them. It
// only says what to add (`add`, `add-custom`); the tracker does the adding.
const props = defineProps({
  // The sheet refs of the characters already in the encounter (a character can't be in it twice).
  presentCharacters: { type: Array, default: () => [] }
})
const emit = defineEmits(['add', 'add-custom'])

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'adversary', label: 'Adversaries' },
  { value: 'character', label: 'Characters' }
]
const MAX_COUNT = 20

const sheets = ref([])
const loading = ref(true)
const loadError = ref('')
const query = ref('')
const filter = ref('all')
const counts = reactive({})
const customName = ref('')

const present = computed(() => new Set(props.presentCharacters))

const shown = computed(() => {
  const needle = query.value.trim().toLowerCase()
  return sheets.value.filter((sheet) => {
    if (filter.value !== 'all' && sheet.type !== filter.value) return false
    if (!needle) return true
    return [sheet.name, sheet.subtitle || '', sheet.folder, ...sheet.tags].some((text) => text.toLowerCase().includes(needle))
  })
})

const countersText = (sheet) =>
  Object.entries(sheet.resources).map(([name, spec]) => `${name} ${spec.max}`).join(' · ')

function add(sheet) {
  const count = Math.max(1, Math.min(MAX_COUNT, Math.floor(Number(counts[sheet.ref])) || 1))
  emit('add', sheet, count)
}

function addCustom() {
  const name = customName.value.trim()
  if (!name) return
  emit('add-custom', name)
  customName.value = ''
}

onMounted(async () => {
  try {
    sheets.value = await fetchSheets()
    sheets.value.forEach((sheet) => { counts[sheet.ref] = 1 })
  } catch (err) {
    loadError.value = errorMessage(err)
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.add-panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);
  background: var(--surface-sunken);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg);
}

.add-controls {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}

.add-search {
  flex: 1;
  min-width: 12rem;
}

.add-filter {
  display: flex;
  gap: var(--space-1);
}

.add-filter-btn {
  padding: 0 var(--space-3);
  min-height: var(--control-md);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  font-size: var(--text-sm);
  cursor: pointer;
}

.add-filter-btn.active {
  border-color: var(--accent);
  background: var(--accent-a20);
  color: var(--text-primary);
}

.add-note {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--text-secondary);
}

.add-error {
  color: var(--status-error);
}

.add-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  max-height: 18rem;
  overflow-y: auto;
  list-style: none;
}

.add-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  background: var(--surface-raised);
}

.add-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-1) var(--space-3);
}

.add-name {
  font-weight: 600;
  color: var(--text-primary);
}

.add-type {
  font-size: var(--text-xs);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--accent-soft);
}

.add-type--character {
  color: var(--status-success);
}

.add-sub,
.add-counters {
  font-size: var(--text-sm);
  color: var(--text-muted);
}

.add-counters {
  font-family: var(--font-mono);
}

.add-count input {
  width: 4.5rem;
}

.add-custom {
  display: flex;
  gap: var(--space-2);
}

.add-custom input {
  flex: 1;
}
</style>
