<template>
  <div class="range-bands">
    <p class="hint">
      The ruler, moving tokens and areas name the range a distance falls in.
      Reaches are in {{ unit }}; leave the last one empty for anything further.
    </p>

    <ol v-if="draft.length" class="bands">
      <li v-for="(band, i) in draft" :key="i" class="band">
        <input class="rk-input band-name" maxlength="40" :value="band.name" :disabled="disabled" :aria-label="`Name of range ${i + 1}`" placeholder="Name" @change="setName(i, $event.target.value)" />
        <label class="band-max">
          <span class="visually-hidden">Reach of {{ band.name || `range ${i + 1}` }}</span>
          <span aria-hidden="true">≤</span>
          <input class="rk-input" type="number" min="0" step="any" :value="band.max ?? ''" :disabled="disabled" :placeholder="i === draft.length - 1 ? 'Any' : ''" @change="setMax(i, $event.target.value)" />
        </label>
        <button type="button" class="rk-icon-btn rk-icon-btn--sm danger" :disabled="disabled" :aria-label="`Remove ${band.name || 'this range'}`" @click="remove(i)">
          <span class="mdi mdi-close"></span>
        </button>
      </li>
    </ol>

    <p v-if="problem" class="problem" role="alert">{{ problem }}</p>

    <div class="row">
      <button type="button" class="rk-btn rk-btn--sm" :disabled="disabled || draft.length >= MAX_BANDS" @click="addBand">
        <span class="mdi mdi-plus"></span> Add a range
      </button>
      <button v-if="!draft.length" type="button" class="rk-btn rk-btn--sm" :disabled="disabled" @click="useExample">
        Start from an example
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'

// A map's range bands (backend models/battlemap.py RangeBand): named reaches,
// nearest first, the last one possibly without limit. Their names and reaches
// are the table's own; the example is only somewhere to start. A list that
// isn't in order yet is kept here, and said what is wrong with, until it is:
// only lists the map accepts are sent (`change`).
const props = defineProps({
  bands: { type: Array, default: () => [] },
  unit: { type: String, default: 'cell' },
  disabled: { type: Boolean, default: false }
})

const emit = defineEmits(['change'])

const MAX_BANDS = 12
// A place to start from, in whatever the unit is: rename and resize at will.
const EXAMPLE = [
  { name: 'Melee', max: 1 },
  { name: 'Very close', max: 3 },
  { name: 'Close', max: 6 },
  { name: 'Far', max: 12 },
  { name: 'Very far', max: null }
]

const draft = ref([])
watch(() => props.bands, (bands) => { draft.value = (bands || []).map((band) => ({ name: band.name, max: band.max ?? null })) }, { immediate: true, deep: true })

const problem = computed(() => problemOf(draft.value))

function problemOf(bands) {
  if (bands.some((band) => !band.name.trim())) return 'Every range needs a name.'
  if (bands.slice(0, -1).some((band) => band.max === null)) return 'Only the last range may reach without limit.'
  const reaches = bands.map((band) => band.max).filter((max) => max !== null)
  if (reaches.some((max, i) => i > 0 && max <= reaches[i - 1])) return 'Each range must reach further than the one before.'
  return ''
}

function update(next) {
  draft.value = next
  if (!problemOf(next)) emit('change', next.map((band) => ({ name: band.name.trim(), max: band.max })))
}

const setName = (i, name) => update(draft.value.map((band, at) => (at === i ? { ...band, name: name.slice(0, 40) } : band)))

function setMax(i, value) {
  const max = value === '' || !(Number(value) > 0) ? null : Number(value)
  update(draft.value.map((band, at) => (at === i ? { ...band, max } : band)))
}

const remove = (i) => update(draft.value.filter((_, at) => at !== i))

function addBand() {
  const reaches = draft.value.map((band) => band.max).filter((max) => max !== null)
  const furthest = reaches.length ? reaches[reaches.length - 1] : 0
  // Before an unlimited last one, or at the end.
  const band = { name: `Range ${draft.value.length + 1}`, max: furthest ? furthest * 2 : 1 }
  const last = draft.value[draft.value.length - 1]
  update(last && last.max === null ? [...draft.value.slice(0, -1), band, last] : [...draft.value, band])
}

const useExample = () => update(EXAMPLE.map((band) => ({ ...band })))
</script>

<style scoped>
.range-bands {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.hint {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.bands {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}

.band {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.band-name {
  flex: 1;
  min-width: 0;
}

.band-max {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  width: 6rem;
  color: var(--text-muted);
}

.band-max input {
  width: 100%;
}

.problem {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--status-warning);
}

.row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
</style>
