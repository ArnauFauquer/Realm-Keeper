<template>
  <DocumentModal :kind="DOC_TYPES.character" :modal="modal" :api="charactersApi" :can-edit="!!user">
    <template #thumb="{ item }">
      <span class="character-thumb" :class="{ orphan: isOrphan(item) }" :title="isOrphan(item) ? 'No sheet in the vault has this id' : null">
        <span class="mdi" :class="isOrphan(item) ? 'mdi-account-alert-outline' : 'mdi-account'"></span>
        <span v-if="isOrphan(item)" class="orphan-label">No sheet</span>
      </span>
    </template>
    <template #editor="{ id, back, close }">
      <CharacterEditor :key="id" :character-id="id" :can-interact="!!user" @gone="back" @close="close" />
    </template>
  </DocumentModal>
</template>

<script setup>
import { ref, watch } from 'vue'
import DocumentModal from './DocumentModal.vue'
import CharacterEditor from './CharacterEditor.vue'
import { charactersApi } from '@/api/docs'
import { fetchSheets } from '@/api/sheets'
import { useAuth } from '@/composables/useAuth'
import { useDocModal } from '@/composables/useDocModal'
import { DOC_TYPES } from '@/utils/docTypes'

// The saved values of the `character` sheets, one per character: which ones no
// longer have a sheet in the vault, and what to do with them.
const { user } = useAuth()
const modal = useDocModal('character')

// The ids of the character sheets in the vault, to tell the orphans apart.
const sheetIds = ref(null)
const isOrphan = (item) => !!sheetIds.value && !sheetIds.value.has(item.id)
watch(modal.isOpen, async (open) => {
  if (!open) return
  try {
    sheetIds.value = new Set((await fetchSheets()).filter((s) => s.type === 'character').map((s) => s.id))
  } catch {
    sheetIds.value = null
  }
})
</script>

<style scoped>
.character-thumb {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-1);
  color: var(--text-muted);
}

.character-thumb .mdi {
  font-size: 2.5rem;
}

.character-thumb.orphan {
  color: var(--status-warning);
}

.orphan-label {
  font-size: var(--text-xs);
}
</style>
