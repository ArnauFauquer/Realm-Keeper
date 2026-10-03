<template>
  <DocumentModal :kind="DOC_TYPES.encounter" :modal="modal" :api="encountersApi" :can-edit="!!user">
    <template #editor="{ id }">
      <EncounterTracker :key="id" :encounter-id="id" :can-interact="!!user" />
    </template>
  </DocumentModal>
</template>

<script setup>
import DocumentModal from './DocumentModal.vue'
import EncounterTracker from './EncounterTracker.vue'
import { encountersApi } from '@/api/docs'
import { useAuth } from '@/composables/useAuth'
import { useDocModal } from '@/composables/useDocModal'
import { DOC_TYPES } from '@/utils/docTypes'

const { user } = useAuth()
const modal = useDocModal('encounter')
</script>
