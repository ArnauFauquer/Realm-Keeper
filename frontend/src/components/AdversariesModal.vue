<template>
  <DocumentModal :kind="DOC_TYPES.adversary" :modal="modal" :api="adversariesApi" :can-edit="!!user">
    <template #editor="{ id, doc, markDirty }">
      <SheetEditor
        :id="id"
        v-model="doc.source"
        type="adversary"
        :name="doc.name"
        :can-edit="!!user"
        @update:model-value="markDirty"
      />
    </template>
  </DocumentModal>
</template>

<script setup>
import DocumentModal from './DocumentModal.vue'
import SheetEditor from './SheetEditor.vue'
import { adversariesApi } from '@/api/docs'
import { useAuth } from '@/composables/useAuth'
import { useDocModal } from '@/composables/useDocModal'
import { DOC_TYPES } from '@/utils/docTypes'

// The adversaries, in folders: templates, edited whole and saved with the
// modal's Save button. A note shows one with `adversary:<id>`.
const { user } = useAuth()
const modal = useDocModal('adversary')
</script>
