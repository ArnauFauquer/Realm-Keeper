<template>
  <div class="sheet-ref-picker">
    <button type="button" class="rk-btn rk-btn--sm" :aria-expanded="open" @click="toggle">
      <span class="mdi mdi-card-account-details-outline"></span> Sheet
    </button>

    <div v-if="open" class="picker-panel" role="dialog" aria-label="Insert a character or adversary">
      <input
        ref="searchInput"
        v-model="query"
        class="rk-input picker-search"
        type="search"
        placeholder="Search characters and adversaries…"
        aria-label="Search characters and adversaries"
        @keydown.esc="open = false"
        @keydown.enter.prevent="shown[0] && pick(shown[0])"
      />
      <p v-if="loading" class="picker-note">Loading…</p>
      <p v-else-if="error" class="picker-note picker-error" role="alert">{{ error }}</p>
      <p v-else-if="!sheets.length" class="picker-note">
        No characters or adversaries yet: create them from the sidebar's Characters and Adversaries tools.
      </p>
      <p v-else-if="!shown.length" class="picker-note">Nothing matches.</p>
      <ul v-else class="picker-list">
        <li v-for="sheet in shown" :key="`${sheet.type}:${sheet.ref}`">
          <button type="button" class="picker-item" @click="pick(sheet)">
            <span class="mdi" :class="DOC_TYPES[sheet.type].icon"></span>
            <span class="picker-name">{{ sheet.name }}</span>
            <span v-if="sheet.folder" class="picker-folder">{{ sheet.folder }}</span>
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, ref } from 'vue'
import { fetchSheets } from '@/api/sheets'
import { DOC_TYPES } from '@/utils/docTypes'
import { docRefMarkdown } from '@/utils/inlineRefs'

// The note editor's "Sheet" button: pick a character or an adversary, and the
// link that shows it (`character:<id>`, `adversary:<id>`) is inserted.
const emit = defineEmits(['pick'])

const open = ref(false)
const loading = ref(false)
const error = ref('')
const sheets = ref([])
const query = ref('')
const searchInput = ref(null)

const shown = computed(() => {
  const needle = query.value.trim().toLowerCase()
  if (!needle) return sheets.value
  return sheets.value.filter((s) => [s.name, s.folder, s.subtitle || '', ...s.tags].some((text) => text.toLowerCase().includes(needle)))
})

async function toggle() {
  open.value = !open.value
  if (!open.value) return
  query.value = ''
  nextTick(() => searchInput.value?.focus())
  loading.value = true
  error.value = ''
  try {
    sheets.value = await fetchSheets()
  } catch (err) {
    error.value = err.response?.data?.detail || err.message
  } finally {
    loading.value = false
  }
}

function pick(sheet) {
  open.value = false
  emit('pick', docRefMarkdown(sheet.type, sheet.ref))
}
</script>

<style scoped>
.sheet-ref-picker {
  position: relative;
}

.picker-panel {
  position: absolute;
  z-index: 20;
  top: calc(100% + var(--space-1));
  left: 0;
  width: min(22rem, calc(100vw - 2rem));
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-2);
  border: 1px solid var(--border-medium);
  border-radius: var(--radius-lg);
  background: var(--bg-secondary);
  box-shadow: var(--shadow-lg, 0 10px 30px rgba(0, 0, 0, 0.4));
}

.picker-note {
  margin: 0;
  padding: var(--space-2);
  font-size: var(--text-sm);
  color: var(--text-muted);
}

.picker-error {
  color: var(--status-error);
}

.picker-list {
  max-height: 18rem;
  overflow-y: auto;
  margin: 0;
  padding: 0;
  list-style: none;
}

.picker-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  padding: var(--space-2);
  border: 0;
  border-radius: var(--radius-md);
  background: none;
  color: var(--text-primary);
  font-size: var(--text-sm);
  text-align: left;
  cursor: pointer;
}

.picker-item:hover,
.picker-item:focus-visible {
  background: var(--bg-tertiary);
}

.picker-item .mdi {
  color: var(--text-muted);
}

.picker-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.picker-folder {
  max-width: 45%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-xs);
  color: var(--text-muted);
}
</style>
