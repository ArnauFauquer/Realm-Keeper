<template>
  <DocumentModal :kind="BATTLEMAP_KIND" :modal="modal" :api="battlemapsApi" :can-edit="!!user">
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
import { useBattlemapsModal } from '@/composables/useBattlemapsModal'

const BATTLEMAP_KIND = {
  title: 'Battlemaps',
  plural: 'battlemaps',
  label: 'battlemap',
  icon: 'mdi-grid',
  emptyIcon: 'mdi-grid',
  emptyText: 'No battlemaps yet. Create one to play a fight out on a grid with tokens.'
}

const { user } = useAuth()
const modal = useBattlemapsModal()
</script>
