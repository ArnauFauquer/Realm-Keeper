<template>
  <div v-if="isOpen" class="rk-scrim" @click.self="closeModal">
    <div class="rk-dialog document-modal" role="dialog" aria-modal="true" :aria-label="kind.title">
      <DocumentModalHeader
        :view="view"
        :icon="kind.icon"
        :gallery-title="kind.title"
        :item-title="activeName"
        :can-edit="canEdit"
        :show-save="false"
        :show-send-to-screen="false"
        @back="backToGallery"
        @close="closeModal"
      />

      <div class="document-body">
        <div v-if="view === 'gallery'" class="gallery-view">
          <FolderGallery
            :folders="folders"
            :items="items"
            :item-key="(item) => item.id"
            :current-path="currentPath"
            :loading="loading"
            :error="error"
            :can-edit="canEdit"
            :root-label="kind.title"
            :root-icon="kind.icon"
            :loading-text="`Loading ${kind.plural}...`"
            :empty-icon="kind.emptyIcon"
            :empty-text="kind.emptyText"
            @navigate="goToPath"
            @enter-folder="enterFolder"
            @open-item="(item) => openItem(item.id, item.name)"
            @delete-folder="onDeleteFolder"
            @delete-item="onDeleteItem"
            @create-folder="onCreateFolder"
            @rename-folder="onRenameFolder"
            @rename-item="onRenameItem"
            @move="onMove"
          >
            <template #actions>
              <div v-if="showNewInput" class="new-item-form">
                <input
                  ref="newInputRef"
                  v-model="newName"
                  class="rk-input inline-input"
                  :placeholder="`${kind.label} name`"
                  :aria-label="`${kind.label} name`"
                  @keyup.enter="submitNew"
                  @keyup.esc="showNewInput = false"
                />
                <button class="rk-icon-btn" :aria-label="`Create ${kind.label}`" @click="submitNew"><span class="mdi mdi-check"></span></button>
                <button class="rk-icon-btn" aria-label="Cancel" @click="showNewInput = false"><span class="mdi mdi-close"></span></button>
              </div>
              <button v-else class="rk-btn gallery-action-btn" @click="startNew">
                <span class="mdi mdi-plus"></span> New {{ kind.label }}
              </button>
            </template>
            <template #thumb="{ item }">
              <slot name="thumb" :item="item">
                <span class="mdi" :class="kind.thumbIcon || kind.icon"></span>
              </slot>
            </template>
          </FolderGallery>
        </div>

        <div v-else class="editor-view">
          <!-- (not `:name`: that would rename the slot itself) -->
          <slot name="editor" :id="activeId" :title="activeName" :close="closeModal"></slot>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import FolderGallery from './FolderGallery.vue'
import DocumentModalHeader from './DocumentModalHeader.vue'
import { useDocCollection } from '@/composables/useDocCollection'

// The modal every kind of document shares: a folder gallery to browse, create,
// rename, move and delete them in, and an editor for the one that is open —
// which is the only part that differs, so it is the `editor` slot. `kind`
// says how to word it: { title, plural, label, icon, thumbIcon, emptyIcon,
// emptyText }. `modal` is the kind's open/close state (useModalState.js) and
// `api` its client (api/docs.js).
const props = defineProps({
  kind: { type: Object, required: true },
  modal: { type: Object, required: true },
  api: { type: Object, required: true },
  canEdit: { type: Boolean, default: false }
})

const { folders, items, loading, error, fetchTree, create, remove, move, rename, createFolder, removeFolder, renameFolder, moveFolder } =
  useDocCollection(props.api)

const isOpen = computed(() => props.modal.isOpen.value)

const view = ref('gallery')
const currentPath = ref('')
const activeId = ref(null)
const activeName = ref(null)
const showNewInput = ref(false)
const newName = ref('')
const newInputRef = ref(null)

watch(isOpen, (open) => {
  if (!open) return
  const target = props.modal.targetId.value
  props.modal.targetId.value = null
  if (target) {
    // Opened on one document (a sheet's "Open it"): skip the gallery.
    openItem(target)
  } else if (view.value === 'gallery') {
    currentPath.value = ''
    fetchTree('')
  }
})

function closeModal() {
  props.modal.close()
  view.value = 'gallery'
  activeId.value = null
  activeName.value = null
}

async function openItem(id, name = null) {
  activeId.value = id
  activeName.value = name
  view.value = 'editor'
  if (name) return
  // Opened by id: its name is what the header shows, and the listing has it.
  try {
    const all = await props.api.fetchAll()
    if (activeId.value === id) activeName.value = all.find((item) => item.id === id)?.name || null
  } catch {
    // The editor shows the problem if there is one; the header just has no title.
  }
}

function backToGallery() {
  view.value = 'gallery'
  activeId.value = null
  activeName.value = null
  fetchTree(currentPath.value)
}

const failure = (err) => { error.value = err.response?.data?.detail || err.message }

const folderPath = (folder) => (currentPath.value ? `${currentPath.value}/${folder}` : folder)

function startNew() {
  showNewInput.value = true
  nextTick(() => newInputRef.value?.focus())
}

async function submitNew() {
  const name = newName.value.trim()
  if (!name) return
  newName.value = ''
  showNewInput.value = false
  try {
    const created = await create(name, '', currentPath.value)
    openItem(created.id, created.name)
  } catch (err) {
    failure(err)
  }
}

async function onDeleteItem(item) {
  if (!window.confirm(`Delete ${props.kind.label} "${item.name}"? This cannot be undone.`)) return
  try {
    await remove(currentPath.value, item.id)
  } catch (err) {
    failure(err)
  }
}

async function onRenameItem(item, name) {
  try {
    await rename(currentPath.value, item.id, name)
  } catch (err) {
    failure(err)
  }
}

function enterFolder(folder) {
  currentPath.value = folderPath(folder)
  fetchTree(currentPath.value)
}

function goToPath(path) {
  currentPath.value = path
  fetchTree(path)
}

async function onCreateFolder(name) {
  try {
    await createFolder(currentPath.value, name)
  } catch (err) {
    failure(err)
  }
}

async function onRenameFolder(folder, name) {
  try {
    await renameFolder(currentPath.value, folderPath(folder), name)
  } catch (err) {
    failure(err)
  }
}

async function onDeleteFolder(folder) {
  if (!window.confirm(`Delete folder "${folder}" and everything inside it?`)) return
  try {
    await removeFolder(currentPath.value, folderPath(folder))
  } catch (err) {
    failure(err)
  }
}

async function onMove(dragItem, destPath) {
  try {
    if (dragItem.type === 'folder') {
      const sourcePath = folderPath(dragItem.name)
      if (sourcePath === destPath) return
      await moveFolder(currentPath.value, sourcePath, destPath)
    } else {
      await move(currentPath.value, dragItem.item.id, destPath)
    }
  } catch (err) {
    failure(err)
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

.gallery-view {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-6);
}

.new-item-form {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}

.editor-view {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
}
</style>
