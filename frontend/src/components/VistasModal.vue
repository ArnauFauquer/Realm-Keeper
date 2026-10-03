<template>
  <DocumentModal :kind="VISTA" :modal="modal" :api="vistasApi" :can-edit="!!user">
    <template #editor="{ doc, markDirty, setAsset }">
      <VistaCanvas
        :vista="doc"
        :editable="!!user"
        @change="markDirty"
        @set-background="(url) => setAsset('background', url)"
      />
    </template>
  </DocumentModal>
</template>

<script setup>
import VistaCanvas from './VistaCanvas.vue'
import DocumentModal from './DocumentModal.vue'
import { vistasApi } from '@/api/docs'
import { useAuth } from '@/composables/useAuth'
import { useDocModal } from '@/composables/useDocModal'
import { DOC_TYPES } from '@/utils/docTypes'

// What is a vista's own is only its canvas: the gallery, saving, the screen and
// the rest are DocumentModal's.
const VISTA = DOC_TYPES.vista
const { user } = useAuth()
const modal = useDocModal('vista')
</script>
