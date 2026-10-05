<template>
  <div v-if="isOpen" class="rk-scrim" @click.self="closeModal">
    <div class="rk-dialog document-modal" role="dialog" aria-modal="true" :aria-label="activeName || kind.title">
      <DocumentModalHeader
        view="editor"
        :icon="kind.icon"
        gallery-title="Observatory"
        :item-title="activeName"
        :can-edit="canEdit"
        :show-save="saved"
        :has-unsaved-changes="hasUnsavedChanges"
        :saving="saving"
        :show-send-to-screen="!!kind.screen"
        :can-send-to-screen="!!activeDoc?.[kind.imageField]"
        :sending-to-screen="sendingToScreen"
        :live-supported="!!kind.screen"
        :live="live"
        :copy-text="kind.embeddable && activeId ? docRefMarkdown(kind.type, activeId) : null"
        @back="backToObservatory"
        @save="saveNow"
        @send-to-screen="sendToScreen"
        @toggle-live="toggleLive(hasUnsavedChanges)"
        @close="closeModal"
      />

      <div class="document-body">
        <div v-if="loadError" class="load-error">
          <div class="rk-alert" role="alert">
            <span class="mdi mdi-alert-circle-outline"></span>
            <span>{{ loadError }}</span>
          </div>
        </div>

        <div v-else-if="saved" class="editor-view editor-view--canvas">
          <div v-if="loadingDoc" class="loading-state" role="status">
            <span class="rk-spinner rk-spinner--lg"></span>
            <span>Loading {{ kind.label }}...</span>
          </div>
          <slot
            v-else-if="activeDoc"
            name="editor"
            :id="activeId"
            :title="activeName"
            :close="closeModal"
            :doc="activeDoc"
            :markDirty="markDirty"
            :setAsset="setAsset"
          ></slot>
        </div>

        <div v-else class="editor-view">
          <!-- (not `:name`: that would rename the slot itself) -->
          <slot name="editor" :id="activeId" :title="activeName" :close="closeModal" :back="backToObservatory"></slot>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import DocumentModalHeader from './DocumentModalHeader.vue'
import { folderOf, useObservatoryModal } from '@/composables/useObservatoryModal'
import { useLiveScreen } from '@/composables/useLiveScreen'
import { useUnsavedChangesGuard } from '@/composables/useUnsavedChangesGuard'
import { docRefMarkdown } from '@/utils/inlineRefs'
import { savePayload, screenPayload } from '@/utils/docTypes'

// The editor every kind of document shares, opened on one document (from the
// Observatory, a note's embed, a sheet's "Open it"): its header, and the
// editor itself, which is the only part that differs, so it is the `editor`
// slot. Back goes to the Observatory, in the document's folder. `kind` is the
// kind's entry in utils/docTypes.js (how to word it, how it is saved and shown
// on the screen), `modal` its open/close state (useDocModal.js) and `api` its
// client (api/docs.js).
//
// Two ways of editing, by what the kind says:
// - Live (encounters, battlemaps, characters): the editor owns the document,
//   which the server holds and changes by commands; there is nothing to save.
//   The slot gets { id, title, close, back }.
// - Saved (charts, vistas, adversaries: `kind.saved`): this loads the
//   document, the editor changes it in place and calls `markDirty()`, and a
//   Save button sends it whole. The slot gets { doc, markDirty, setAsset, id,
//   title, close }, where setAsset(route, url) sets its picture to an
//   Observatory image. One that is `kind.screen` can also be sent to the table
//   screen, and mirrored there as it is edited.
const props = defineProps({
  kind: { type: Object, required: true },
  modal: { type: Object, required: true },
  api: { type: Object, required: true },
  canEdit: { type: Boolean, default: false }
})

const saved = !!props.kind.saved
const isOpen = computed(() => props.modal.isOpen.value)
const observatory = useObservatoryModal()

const activeId = ref(null)
const activeName = ref(null)
const activeDoc = ref(null)
const loadingDoc = ref(false)
const loadError = ref(null)
const hasUnsavedChanges = ref(false)
const saving = ref(false)

// What the screen shows is the document as it is right now, saved or not.
const screen = props.kind.screen
  ? useLiveScreen(props.kind.type, activeDoc, (doc) => screenPayload(props.kind, doc))
  : { live: ref(false), sending: ref(false), sendToScreen: () => {}, toggle: () => {}, stop: () => {} }
const { live, sending: sendingToScreen, sendToScreen, toggle: toggleLive, stop: stopLive } = screen

const { confirmDiscard } = useUnsavedChangesGuard(
  hasUnsavedChanges, `You have unsaved changes to this ${props.kind.label}. Discard them?`
)

watch(isOpen, (open) => {
  if (!open) return
  const target = props.modal.targetId.value
  props.modal.targetId.value = null
  if (target) {
    openItem(target)
  } else {
    // Nothing to edit: the documents are found in the Observatory.
    props.modal.close()
    observatory.open()
  }
})

function reset() {
  activeId.value = null
  activeName.value = null
  activeDoc.value = null
  loadError.value = null
  hasUnsavedChanges.value = false
}

function leave() {
  if (!confirmDiscard()) return false
  stopLive({ revert: hasUnsavedChanges.value })
  props.modal.close()
  return true
}

function closeModal() {
  if (leave()) reset()
}

function backToObservatory() {
  const folder = folderOf(activeId.value)
  if (!leave()) return
  reset()
  observatory.open(folder)
}

async function openItem(id) {
  reset()
  activeId.value = id
  if (saved) return loadDoc(id)
  // Opened by id: its name is what the header shows, and the listing has it.
  try {
    const all = await props.api.fetchAll()
    if (activeId.value === id) activeName.value = all.find((item) => item.id === id)?.name || null
  } catch {
    // The editor shows the problem if there is one; the header just has no title.
  }
}

async function loadDoc(id) {
  loadingDoc.value = true
  try {
    const doc = await props.api.fetch(id)
    if (activeId.value !== id) return // moved on while it loaded
    activeDoc.value = doc
    activeName.value = doc.name
    hasUnsavedChanges.value = false
  } catch (err) {
    loadError.value = err.response?.data?.detail || err.message
  } finally {
    loadingDoc.value = false
  }
}

const markDirty = () => { hasUnsavedChanges.value = true }

async function saveNow() {
  const doc = activeDoc.value
  if (!doc || saving.value) return
  saving.value = true
  try {
    await props.api.save(doc.id, savePayload(props.kind, doc))
    hasUnsavedChanges.value = false
  } catch (err) {
    console.error(`Failed to save ${props.kind.label}:`, err)
  } finally {
    saving.value = false
  }
}

// The picture is set through its own route (which checks it is an Observatory
// image) and at once, not with the rest of the changes on Save.
async function setAsset(route, url) {
  const doc = activeDoc.value
  if (!doc) return
  try {
    const updated = await props.api.setAsset(doc.id, route, url)
    doc[props.kind.imageField] = updated[props.kind.imageField]
  } catch (err) {
    console.error(`Failed to set the ${props.kind.label}'s picture:`, err)
  }
}
</script>

<style scoped>
/* Shell comes from .rk-scrim / .rk-dialog; only the large-canvas size lives here. */
.document-modal {
  width: min(100%, 1400px);
  height: 90dvh;
}

.document-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.load-error {
  flex: 1;
  padding: var(--space-6);
}

.editor-view {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
}

/* A map or a scene fills the space it is given, and does not scroll. */
.editor-view--canvas {
  flex-direction: row;
  overflow: hidden;
}

.loading-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  color: var(--text-secondary);
  font-size: var(--text-sm);
}
</style>
