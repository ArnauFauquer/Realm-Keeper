<template>
  <DocumentModal :kind="DOC_TYPES.character" :modal="modal" :api="charactersApi" :can-edit="!!user">
    <template #editor="{ id }">
      <CharacterEditor :key="id" :character-id="id" :can-interact="!!user" />
    </template>
  </DocumentModal>
</template>

<script setup>
import DocumentModal from './DocumentModal.vue'
import CharacterEditor from './CharacterEditor.vue'
import { charactersApi } from '@/api/docs'
import { useAuth } from '@/composables/useAuth'
import { useDocModal } from '@/composables/useDocModal'
import { DOC_TYPES } from '@/utils/docTypes'

// The characters, in folders: each one's sheet and live counters. A note shows
// one with `character:<id>` (the copy button of its card gives it).
const { user } = useAuth()
const modal = useDocModal('character')
</script>
