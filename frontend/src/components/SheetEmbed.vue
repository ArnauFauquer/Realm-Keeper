<template>
  <div class="sheet-embed">
    <p v-if="!canInteract" class="embed-state">
      <span class="mdi mdi-lock-outline"></span> Sign in to see this {{ type }}
    </p>
    <p v-else-if="loading" class="embed-state" aria-busy="true">
      <span class="rk-spinner"></span> Loading {{ type }}…
    </p>
    <p v-else-if="!doc" class="embed-state error" role="alert">
      <span class="mdi mdi-file-question-outline"></span>
      <code>{{ type }}:{{ id }}</code> {{ loadError || 'was moved or deleted.' }}
    </p>
    <div v-else-if="parsed.error" class="embed-state error" role="alert">
      <span class="mdi mdi-alert-circle-outline"></span> {{ doc.name }}: {{ parsed.error }}
    </div>

    <SheetView v-else :sheet="parsed.sheet" :warnings="parsed.warnings" :can-interact="canInteract" :hide-name="nameShown">
      <!-- A character's counters are its own: the same here, in every
           encounter, and on every other note that shows it. -->
      <template v-if="type === 'character'" #counter="{ resource: r }">
        <ResourceCounter
          :name="r.name"
          :current="doc.resources?.[r.name]?.current ?? r.start ?? r.max"
          :max="doc.resources?.[r.name]?.max ?? r.max"
          :min="doc.resources?.[r.name]?.min ?? r.min"
          :display="r.style"
          :color="r.color"
          :editable="!!doc.resources?.[r.name]"
          @adjust="(by) => adjust(r.name, by)"
        />
      </template>

      <template #footer>
        <div class="sheet-embed-actions">
          <button type="button" class="rk-btn rk-btn--sm" :title="`Edit ${doc.name} in ${kind.title}`" @click="openInModal">
            <span class="mdi mdi-pencil-outline"></span> Edit
          </button>
          <AddToEncounter :sheet="parsed.sheet" />
        </div>
      </template>
    </SheetView>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import SheetView from './SheetView.vue'
import ResourceCounter from './ResourceCounter.vue'
import AddToEncounter from './AddToEncounter.vue'
import { adversariesApi } from '@/api/docs'
import { useCharacters } from '@/composables/useCharacters'
import { useDocModal } from '@/composables/useDocModal'
import { DOC_TYPES } from '@/utils/docTypes'
import { parseSheetDoc } from '@/utils/sheet'

// A character or an adversary shown in a note (`character:<id>`,
// `adversary:<id>`): its sheet, a character's counters live. The note view
// mounts this into the placeholder its markdown renderer leaves behind.
const props = defineProps({
  type: { type: String, required: true }, // 'character' | 'adversary'
  id: { type: String, required: true },
  // Signed in: the documents are behind login, like charts and vistas.
  canInteract: { type: Boolean, default: false },
  // The note's title and headings: a sheet named like one of them doesn't
  // repeat its name right under it.
  pageHeadings: { type: Array, default: () => [] }
})

const kind = DOC_TYPES[props.type]

// A character is followed live (its counters change as they are played); an
// adversary is a template, read once.
const characters = props.type === 'character' && props.canInteract ? useCharacters(() => [props.id]) : null
const adversary = ref(null)
const adversaryLoading = ref(false)
const loadError = ref('')

async function loadAdversary() {
  adversaryLoading.value = true
  loadError.value = ''
  try {
    adversary.value = await adversariesApi.fetch(props.id)
  } catch (err) {
    adversary.value = null
    if (err.response?.status !== 404) loadError.value = err.response?.data?.detail || err.message
  } finally {
    adversaryLoading.value = false
  }
}
if (props.type === 'adversary' && props.canInteract) watch(() => props.id, loadAdversary, { immediate: true })

const doc = computed(() => (characters ? characters.stateOf(props.id) : adversary.value))
const loading = computed(() => (characters ? characters.status.value === 'loading' : adversaryLoading.value))

const parsed = computed(() => {
  try {
    return parseSheetDoc(doc.value, props.type)
  } catch (e) {
    return { error: e.message }
  }
})

// Compared without case, accents, quotes or punctuation: `Gargamel "Asher"`
// is the heading `Gargamel “Asher”` once markdown has curled its quotes.
const plain = (text) => String(text || '').normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().toLowerCase()
const nameShown = computed(() => !!parsed.value.sheet && props.pageHeadings.some((h) => plain(h) === plain(parsed.value.sheet.name)))

async function adjust(resource, by) {
  try {
    await characters.adjust(props.id, resource, by)
  } catch (err) {
    console.error('Failed to change a counter:', err)
  }
}

const modal = useDocModal(props.type)
const openInModal = () => modal.open(props.id)
</script>

<style scoped>
.sheet-embed {
  margin: var(--space-4) 0;
}

.embed-state {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
  padding: var(--space-3) var(--space-4);
  border: 1px dashed var(--border-medium);
  border-radius: var(--radius-lg);
  color: var(--text-secondary);
  font-size: var(--text-sm);
}

.embed-state.error {
  border-style: solid;
  border-color: var(--status-error-border);
  background: var(--status-error-bg);
}

.sheet-embed-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: var(--space-2);
}
</style>
