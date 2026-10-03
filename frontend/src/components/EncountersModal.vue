<template>
  <DocumentModal :kind="ENCOUNTER_KIND" :modal="modal" :api="encountersApi" :can-edit="!!user">
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
import { useEncountersModal } from '@/composables/useEncountersModal'

const ENCOUNTER_KIND = {
  title: 'Encounters',
  plural: 'encounters',
  label: 'encounter',
  icon: 'mdi-sword-cross',
  emptyIcon: 'mdi-sword-cross',
  emptyText: 'No encounters yet. Create one to track who is in a fight, their counters and conditions.'
}

const { user } = useAuth()
const modal = useEncountersModal()
</script>
