<template>
  <DocumentModal :kind="CHART" :modal="modal" :api="chartsApi" :can-edit="!!user">
    <template #editor="{ doc, markDirty, setAsset, close }">
      <ChartCanvas
        :chart="doc"
        :editable="!!user"
        :notes="notes"
        @change="markDirty"
        @set-map-image="(url) => setAsset('image', url)"
        @open-note="(notePath) => openNote(notePath, close)"
      />
    </template>
  </DocumentModal>
</template>

<script setup>
import { useRouter } from 'vue-router'
import ChartCanvas from './ChartCanvas.vue'
import DocumentModal from './DocumentModal.vue'
import { chartsApi } from '@/api/docs'
import { useAuth } from '@/composables/useAuth'
import { useDocModal } from '@/composables/useDocModal'
import { DOC_TYPES } from '@/utils/docTypes'

// What is a chart's own is only its canvas: the gallery, saving, the screen and
// the rest are DocumentModal's.
defineProps({
  notes: { type: Array, default: () => [] }
})

const CHART = DOC_TYPES.chart
const router = useRouter()
const { user } = useAuth()
const modal = useDocModal('chart')

// A pin that points at a note: close the chart (asking about unsaved changes
// first, which may say no) and go to it.
function openNote(notePath, close) {
  close()
  if (modal.isOpen.value) return
  router.push(`/note/${notePath.split('/').map(encodeURIComponent).join('/')}`)
}
</script>
