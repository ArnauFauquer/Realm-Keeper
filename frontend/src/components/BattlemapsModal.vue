<template>
  <DocumentModal :kind="DOC_TYPES.battlemap" :modal="modal" :api="battlemapsApi" :can-edit="!!user">
    <template #editor="{ id }">
      <BattlemapEditor :key="id" :battlemap-id="id" :can-interact="!!user" />
    </template>
  </DocumentModal>
</template>

<script setup>
import DocumentModal from './DocumentModal.vue'
import BattlemapEditor from './BattlemapEditor.vue'
import { battlemapsApi } from '@/api/docs'
import { useAuth } from '@/composables/useAuth'
import { useDocModal } from '@/composables/useDocModal'
import { DOC_TYPES } from '@/utils/docTypes'

const { user } = useAuth()
const modal = useDocModal('battlemap')
</script>
