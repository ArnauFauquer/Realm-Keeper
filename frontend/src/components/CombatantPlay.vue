<template>
  <article class="combatant-play" :class="{ 'is-defeated': combatant.defeated }">
    <header class="play-head">
      <img v-if="portrait" :src="portrait" alt="" class="play-portrait" />
      <span v-else class="play-portrait play-portrait--empty" aria-hidden="true">{{ initials(combatant.name) }}</span>
      <div class="play-title">
        <h3 class="play-name">{{ combatant.name }}</h3>
        <div class="play-meta">
          <span class="play-kind" :class="`play-kind--${combatant.type}`">{{ combatant.type }}</span>
          <span v-if="sheet?.subtitle" class="play-subtitle">{{ sheet.subtitle }}</span>
        </div>
      </div>
      <div class="play-actions" role="group" :aria-label="`${combatant.name}: actions`">
        <button
          type="button"
          class="rk-icon-btn rk-icon-btn--sm"
          :class="{ 'is-on': combatant.defeated }"
          :disabled="!canInteract"
          :aria-pressed="!!combatant.defeated"
          :title="combatant.defeated ? 'Back in the fight' : 'Mark as defeated'"
          :aria-label="combatant.defeated ? `Bring ${combatant.name} back in the fight` : `Mark ${combatant.name} as defeated`"
          @click="emit('patch', { defeated: !combatant.defeated })"
        >
          <span class="mdi mdi-skull-outline"></span>
        </button>
        <button
          v-if="combatant.sheet && canInteract"
          type="button"
          class="rk-icon-btn rk-icon-btn--sm"
          :title="combatant.type === 'character' ? 'Edit the sheet' : 'Edit the sheet it was made from'"
          :aria-label="`Edit ${combatant.type === 'character' ? combatant.name : 'the template'}'s sheet`"
          @click="emit('edit-sheet')"
        >
          <span class="mdi mdi-pencil-outline"></span>
        </button>
      </div>
    </header>

    <ConditionChips
      :conditions="combatant.conditions || []"
      :name="combatant.name"
      :editable="canInteract"
      @add="(name) => emit('add-condition', name)"
      @remove="(condition) => emit('remove-condition', condition)"
    />

    <!-- Counters the sheet doesn't draw (a combatant made by hand, or a
         sheet changed since it was added): played here all the same. -->
    <div v-if="looseCounters.length" class="play-counters">
      <ResourceCounter
        v-for="r in looseCounters"
        :key="r.name"
        :name="r.name"
        :current="r.current"
        :max="r.max"
        :min="r.min"
        :display="r.style"
        :color="r.color"
        :editable="canInteract"
        @adjust="(by) => emit('adjust', r.name, by)"
      />
    </div>

    <p v-if="sheetState.status === 'loading'" class="play-note" aria-busy="true"><span class="rk-spinner"></span> Loading the sheet…</p>
    <p v-else-if="sheetState.status === 'missing'" class="play-note">
      Its sheet is gone: it was moved or deleted. Its counters still work.
    </p>
    <SheetView
      v-else-if="sheet"
      class="play-sheet"
      :sheet="sheet"
      :can-interact="canInteract"
      :show-header="false"
      :roller-name="combatant.name"
      @rolled="(roll) => emit('rolled', { ...roll, combatant: combatant.id })"
    >
      <!-- Its counters as they stand in the encounter (an adversary's own,
           a character's saved ones), played from the sheet itself. -->
      <template #counter="{ resource: r }">
        <ResourceCounter
          :name="r.name"
          :current="countersByName[r.name]?.current ?? counterStart(r)"
          :max="countersByName[r.name]?.max ?? r.max"
          :min="countersByName[r.name]?.min ?? r.min"
          :display="r.style"
          :color="r.color"
          :editable="canInteract && !!countersByName[r.name]"
          @adjust="(by) => emit('adjust', r.name, by)"
        />
      </template>
    </SheetView>

    <details class="play-notes" :open="!!combatant.notes">
      <summary>Notes</summary>
      <textarea
        class="rk-input"
        rows="3"
        :value="combatant.notes"
        :disabled="!canInteract"
        placeholder="Notes about this one…"
        :aria-label="`Notes about ${combatant.name}`"
        @change="emit('patch', { notes: $event.target.value })"
      ></textarea>
    </details>
  </article>
</template>

<script setup>
import { computed } from 'vue'
import ConditionChips from './ConditionChips.vue'
import ResourceCounter from './ResourceCounter.vue'
import SheetView from './SheetView.vue'
import { counterStart } from '@/utils/sheet'
import { initials } from '@/utils/battlemapGeometry'
import { resolveUrl } from '@/utils/resolveUrl'

// One combatant of an encounter, to play from wherever it is shown (a
// battlemap's sheet panel): its sheet, whole, with its counters live and its
// rolls named after it ("Bugboar 2 · Gore"), its conditions and notes. It
// changes nothing itself: each change is asked for (`adjust`, `patch`,
// `add-condition`, `remove-condition`) for its encounter to apply (see
// composables/useCombatantActions.js), and `rolled` ({ label, formula, total,
// combatant }) says one of its rolls landed: whose it was travels with it,
// since the dice may land after another combatant has been picked.
const props = defineProps({
  combatant: { type: Object, required: true },
  // Its counters: useCombatantActions' countersOf.
  counters: { type: Array, default: () => [] },
  // Its sheet: useCombatantSheets' sheetOf ({ status, sheet }).
  sheetState: { type: Object, default: () => ({ status: 'none' }) },
  canInteract: { type: Boolean, default: false }
})

const emit = defineEmits(['adjust', 'patch', 'add-condition', 'remove-condition', 'rolled', 'edit-sheet'])

const sheet = computed(() => props.sheetState.sheet || null)
const countersByName = computed(() => Object.fromEntries(props.counters.map((r) => [r.name, r])))
const looseCounters = computed(() => props.counters.filter((r) => !sheet.value?.resources?.[r.name]))
const portrait = computed(() => {
  const image = props.combatant.image_url || sheet.value?.image
  return image ? resolveUrl(image) : null
})
</script>

<style scoped>
.combatant-play {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.play-head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.play-portrait {
  flex: none;
  width: 44px;
  height: 44px;
  border-radius: var(--radius-full);
  object-fit: cover;
  border: 2px solid var(--accent-a45);
}

.play-portrait--empty {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--surface-sunken);
  color: var(--text-secondary);
  font-weight: 700;
  font-size: var(--text-sm);
}

.play-title {
  flex: 1;
  min-width: 0;
}

.play-name {
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-display);
  font-size: var(--text-md);
  color: var(--text-primary);
}

.is-defeated .play-name {
  text-decoration: line-through;
  color: var(--text-secondary);
}

.play-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.play-kind {
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--accent-soft);
}

.play-kind--character {
  color: var(--status-success);
}

.play-actions {
  display: flex;
  gap: var(--space-1);
}

.play-actions .is-on {
  color: var(--status-error);
}

.play-counters {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.play-note {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
  font-size: var(--text-sm);
  color: var(--text-muted);
}

/* The panel is the card: the sheet sits in it without one of its own. */
.play-sheet.sheet-card {
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
}

.play-notes summary {
  cursor: pointer;
  font-size: var(--text-sm);
  color: var(--text-muted);
}

.play-notes textarea {
  width: 100%;
  margin-top: var(--space-2);
  resize: vertical;
}
</style>
