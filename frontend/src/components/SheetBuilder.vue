<template>
  <div class="sheet-builder">
    <fieldset class="builder-form" :disabled="!canEdit">
      <legend class="rk-visually-hidden">{{ name }} sheet</legend>

      <!-- What heads the sheet: portrait, subtitle, tags. -->
      <section class="b-card b-head" aria-label="Header">
        <div class="b-portrait">
          <button
            type="button"
            class="b-portrait-pick"
            :class="{ 'has-image': model.image }"
            :aria-label="model.image ? 'Change portrait' : 'Choose portrait'"
            :title="model.image ? 'Change portrait' : 'Choose portrait'"
            @click="pickerOpen = true"
          >
            <img v-if="model.image" :src="resolveUrl(model.image)" alt="" />
            <span v-else class="mdi mdi-account-box-outline"></span>
          </button>
          <button
            v-if="model.image && canEdit"
            type="button"
            class="b-portrait-clear rk-icon-btn rk-icon-btn--sm"
            aria-label="Remove portrait"
            title="Remove portrait"
            @click="model.image = null"
          >
            <span class="mdi mdi-close"></span>
          </button>
        </div>
        <div class="b-head-fields">
          <label class="b-field">
            <span class="b-label">Subtitle</span>
            <input v-model="model.subtitle" class="b-input" type="text" placeholder="Tier 1 Bruiser, Level 3 Ranger..." />
          </label>
          <div class="b-field">
            <span class="b-label">Tags</span>
            <TagsInput v-model="model.tags" label="Sheet tags" :disabled="!canEdit" />
          </div>
        </div>
      </section>

      <!-- The sections, in order. -->
      <div class="b-sections-head">
        <h3 class="b-heading">Sections</h3>
        <label class="b-inline">
          <span class="b-label">Side by side</span>
          <select v-model="model.columns" class="b-input b-select" aria-label="Sections side by side">
            <option :value="null">One per row</option>
            <option v-for="n in columnChoices(model.columns).filter((n) => n > 1)" :key="n" :value="n">{{ n }} columns</option>
          </select>
        </label>
      </div>

      <p v-if="!model.sections.length" class="b-empty">
        A sheet is made of sections: one for its counters (HP, Stress), one for its actions, one for its gear...
      </p>

      <article
        v-for="(section, s) in model.sections"
        :key="keyOf(section)"
        class="b-card b-section"
        :class="dropClass(model.sections, s)"
        :data-section="keyOf(section)"
        @dragover="(e) => dragOver(e, model.sections, s)"
        @drop="(e) => drop(e, model.sections)"
      >
        <header class="b-section-head">
          <DragHandle :list="model.sections" :index="s" what="section" />
          <button
            type="button"
            class="b-fold rk-icon-btn rk-icon-btn--sm"
            :aria-expanded="!isFolded(section)"
            :aria-label="isFolded(section) ? 'Show section' : 'Hide section'"
            @click="toggleFold(section)"
          >
            <span class="mdi" :class="isFolded(section) ? 'mdi-chevron-right' : 'mdi-chevron-down'"></span>
          </button>
          <input
            v-model="section.title"
            class="b-input b-section-title"
            type="text"
            :aria-label="`Section ${s + 1} title`"
            placeholder="Untitled section"
          />
          <span class="b-section-count" aria-hidden="true">{{ sectionSummary(section) }}</span>
          <button
            type="button"
            class="rk-icon-btn rk-icon-btn--sm rk-btn--danger"
            :aria-label="`Delete section ${section.title || s + 1}`"
            title="Delete section"
            @click="removeSection(s)"
          >
            <span class="mdi mdi-trash-can-outline"></span>
          </button>
        </header>

        <div v-show="!isFolded(section)" class="b-section-body">
          <div class="b-section-options">
            <label class="b-inline">
              <span class="b-label">Tab</span>
              <input
                v-model="section.tab"
                class="b-input b-input--sm b-tab-input"
                type="text"
                placeholder="None"
                :list="tabListId"
                aria-label="Tab"
              />
            </label>
            <label class="b-inline">
              <span class="b-label">Entries</span>
              <select v-model="section.columns" class="b-input b-input--sm b-select" aria-label="Entries per row">
                <option :value="null">Auto</option>
                <option v-for="n in columnChoices(section.columns)" :key="n" :value="n">{{ n }} per row</option>
              </select>
            </label>
            <label class="b-check">
              <input v-model="section.wide" type="checkbox" />
              <span>Full width</span>
            </label>
            <label class="b-check" :class="{ 'is-off': !section.title }" :title="section.title ? '' : 'Only a titled section folds'">
              <input v-model="section.collapsed" type="checkbox" :disabled="!section.title" />
              <span>Starts folded</span>
            </label>
          </div>

          <!-- Counters: one row each, the column names once on top. -->
          <div v-if="section.counters.length" class="b-block">
            <div class="b-counter-row b-row-labels" aria-hidden="true">
              <span></span><span>Counter</span><span>Max</span><span>Min</span><span>Start</span><span>Shown as</span><span>Color</span><span></span>
            </div>
            <div
              v-for="(counter, c) in section.counters"
              :key="keyOf(counter)"
              class="b-counter-row b-row"
              :class="dropClass(section.counters, c)"
              @dragover="(e) => dragOver(e, section.counters, c)"
              @drop="(e) => drop(e, section.counters)"
            >
              <DragHandle :list="section.counters" :index="c" what="counter" />
              <input
                v-model="counter.name"
                class="b-input b-input--sm"
                :class="{ 'is-invalid': duplicateCounters.has(counterKey(counter)) }"
                :aria-invalid="duplicateCounters.has(counterKey(counter))"
                type="text"
                placeholder="Name"
                aria-label="Counter name"
                :title="duplicateCounters.has(counterKey(counter)) ? 'Another counter of this sheet has this name' : ''"
              />
              <input :value="counter.max" class="b-input b-input--sm b-num" type="number" aria-label="Maximum" @input="(e) => setInt(counter, 'max', e, false)" />
              <input :value="counter.min" class="b-input b-input--sm b-num" type="number" aria-label="Minimum" @input="(e) => setInt(counter, 'min', e, false)" />
              <input
                :value="counter.start ?? ''"
                class="b-input b-input--sm b-num"
                type="number"
                aria-label="Starts at"
                :placeholder="String(counter.max)"
                @input="(e) => setInt(counter, 'start', e, true)"
              />
              <select v-model="counter.style" class="b-input b-input--sm b-select" aria-label="Shown as">
                <option :value="null">Auto</option>
                <option v-for="display in COUNTER_DISPLAYS" :key="display" :value="display">{{ DISPLAY_LABELS[display] }}</option>
              </select>
              <span class="b-color">
                <input
                  :value="colorHex(counter.color)"
                  class="b-color-input"
                  :class="{ 'is-default': !counter.color }"
                  type="color"
                  :aria-label="counter.color ? `Color ${counter.color}` : 'Color (default)'"
                  @input="counter.color = $event.target.value"
                />
                <button
                  v-if="counter.color && canEdit"
                  type="button"
                  class="b-color-clear"
                  aria-label="Default color"
                  title="Default color"
                  @click="counter.color = null"
                >
                  <span class="mdi mdi-close"></span>
                </button>
              </span>
              <RemoveButton what="counter" @click="section.counters.splice(c, 1)" />
            </div>
          </div>

          <!-- Stats, by group: a group may have a title and fixed columns. -->
          <div v-for="(group, g) in section.stats" :key="keyOf(group)" class="b-block b-group">
            <div class="b-group-head">
              <input v-model="group.title" class="b-input b-input--sm b-group-title" type="text" placeholder="Group title (optional)" aria-label="Group title" />
              <select v-model="group.columns" class="b-input b-input--sm b-select" aria-label="Stats per row">
                <option :value="null">Auto</option>
                <option v-for="n in columnChoices(group.columns)" :key="n" :value="n">{{ n }} per row</option>
              </select>
              <RemoveButton what="group of stats" @click="section.stats.splice(g, 1)" />
            </div>
            <div class="b-stat-row b-row-labels" aria-hidden="true">
              <span></span><span>Label</span><span>Value</span><span>Roll</span><span></span>
            </div>
            <div
              v-for="(stat, t) in group.stats"
              :key="keyOf(stat)"
              class="b-stat-row b-row"
              :class="dropClass(group.stats, t)"
              @dragover="(e) => dragOver(e, group.stats, t)"
              @drop="(e) => drop(e, group.stats)"
            >
              <DragHandle :list="group.stats" :index="t" what="stat" />
              <input v-model="stat.label" class="b-input b-input--sm" type="text" placeholder="Label" aria-label="Stat label" />
              <input
                :value="stat.value ?? ''"
                class="b-input b-input--sm"
                type="text"
                placeholder="Value"
                aria-label="Stat value"
                @input="stat.value = statInput($event.target.value)"
              />
              <input v-model="stat.roll" class="b-input b-input--sm b-mono" type="text" placeholder="No roll" aria-label="Stat roll" title="Dice to roll, like 1d20+2" />
              <RemoveButton what="stat" @click="group.stats.splice(t, 1)" />
            </div>
            <button type="button" class="b-add-row" @click="group.stats.push(newStat())">
              <span class="mdi mdi-plus"></span> Stat
            </button>
          </div>

          <!-- Entries: actions, features, gear... a name, a roll, a text. -->
          <div v-if="section.items.length" class="b-block b-items">
            <div
              v-for="(item, i) in section.items"
              :key="keyOf(item)"
              class="b-item"
              :class="dropClass(section.items, i)"
              @dragover="(e) => dragOver(e, section.items, i)"
              @drop="(e) => drop(e, section.items)"
            >
              <div class="b-item-row">
                <DragHandle :list="section.items" :index="i" what="entry" />
                <input v-model="item.name" class="b-input b-input--sm b-item-name" type="text" placeholder="Entry name" aria-label="Entry name" />
                <input v-model="item.roll" class="b-input b-input--sm b-mono" type="text" placeholder="Roll" aria-label="Entry roll" title="Dice to roll, like 1d20+3" />
                <input v-model="item.cost" class="b-input b-input--sm" type="text" placeholder="Cost" aria-label="Entry cost" title="What using it costs, like 1 Fear" />
                <RemoveButton what="entry" @click="section.items.splice(i, 1)" />
              </div>
              <textarea
                v-model="item.text"
                class="b-input b-textarea"
                rows="2"
                placeholder="What it does. Markdown works, and dice like `1d8+2` roll."
                aria-label="Entry text"
              ></textarea>
              <TagsInput v-model="item.tags" label="Entry tags" placeholder="Tags" :disabled="!canEdit" />
            </div>
          </div>

          <div class="b-add" role="group" :aria-label="`Add to ${section.title || 'section'}`">
            <button type="button" class="b-add-btn" @click="addCounter(section)">
              <span class="mdi mdi-plus"></span> Counter
            </button>
            <button type="button" class="b-add-btn" @click="addStats(section)">
              <span class="mdi mdi-plus"></span> Stats
            </button>
            <button type="button" class="b-add-btn" @click="addItem(section)">
              <span class="mdi mdi-plus"></span> Entry
            </button>
          </div>
        </div>
      </article>

      <button type="button" class="b-add-section" @click="addSection">
        <span class="mdi mdi-plus"></span> Add section
      </button>

      <label class="b-card b-field b-description">
        <span class="b-label">Description</span>
        <textarea
          v-model="model.text"
          class="b-input b-textarea"
          rows="3"
          placeholder="Shown under the sections. Markdown works."
        ></textarea>
      </label>

      <datalist :id="tabListId">
        <option v-for="tab in tabNames" :key="tab" :value="tab"></option>
      </datalist>
    </fieldset>

    <ObservatoryModal
      :is-open="pickerOpen"
      picker-mode
      :start-path="folderOf(id)"
      @close="pickerOpen = false"
      @select="onPortraitPicked"
    />
  </div>
</template>

<script setup>
import { computed, h, nextTick, ref, toRaw, watch } from 'vue'
import TagsInput from './TagsInput.vue'
import ObservatoryModal from './ObservatoryModal.vue'
import { folderOf } from '@/composables/useObservatoryModal'
import { resolveUrl } from '@/utils/resolveUrl'
import {
  COLUMN_CHOICES,
  COUNTER_DISPLAYS,
  bodyFromModel,
  modelFromBody,
  newCounter,
  newItem,
  newSection,
  newStat,
  newStatGroup,
  normalizeBody,
  statInput
} from '@/utils/sheetModel'

// A sheet, built with forms: its header, then sections of counters, stats and
// entries. `modelValue` is the sheet as its document keeps it (JSON); what is
// typed comes back as a whole new sheet, rows still without a name left out.
const props = defineProps({
  type: { type: String, required: true },
  id: { type: String, required: true },
  name: { type: String, default: '' },
  modelValue: { type: Object, default: () => ({}) },
  canEdit: { type: Boolean, default: false }
})
const emit = defineEmits(['update:modelValue'])

const DISPLAY_LABELS = { pips: 'Pips', bar: 'Bar', number: 'Number' }
const tabListId = `sheet-tabs-${Math.random().toString(36).slice(2, 8)}`

const model = ref(modelFromBody(props.modelValue))
// The sheet as last read or written: one that differs came from elsewhere
// (a template, someone else saving it), and is loaded.
let written = JSON.stringify(normalizeBody(props.modelValue))

watch(
  () => JSON.stringify(normalizeBody(props.modelValue)),
  (incoming) => {
    if (incoming === written) return
    written = incoming
    model.value = modelFromBody(props.modelValue)
  }
)
watch(
  model,
  (value) => {
    const body = bodyFromModel(value)
    const json = JSON.stringify(body)
    if (json === written) return
    written = json
    emit('update:modelValue', body)
  },
  { deep: true }
)

// Rows are keyed by identity, so a typed field keeps its focus as rows move.
const keys = new WeakMap()
let lastKey = 0
function keyOf(row) {
  const raw = toRaw(row)
  if (!keys.has(raw)) keys.set(raw, ++lastKey)
  return keys.get(raw)
}

// Folding a section here only hides its fields while building.
const folded = ref(new Set())
const isFolded = (section) => folded.value.has(keyOf(section))
function toggleFold(section) {
  const next = new Set(folded.value)
  const key = keyOf(section)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  folded.value = next
}

function sectionSummary(section) {
  const stats = section.stats.reduce((sum, group) => sum + group.stats.length, 0)
  const parts = [
    [section.counters.length, 'counter'],
    [stats, 'stat'],
    [section.items.length, 'entry']
  ]
    .filter(([n]) => n)
    .map(([n, what]) => `${n} ${n === 1 ? what : what === 'entry' ? 'entries' : `${what}s`}`)
  return parts.join(', ')
}

const tabNames = computed(() => [...new Set((model.value?.sections || []).map((s) => s.tab).filter(Boolean))])
const columnChoices = (current) => (current && !COLUMN_CHOICES.includes(current) ? [...COLUMN_CHOICES, current] : COLUMN_CHOICES)

// Counter names are the sheet's keys for its saved values: two alike would clash.
const counterKey = (counter) => (counter.name || '').trim()
const duplicateCounters = computed(() => {
  const seen = new Set()
  const twice = new Set()
  for (const section of model.value?.sections || []) {
    for (const counter of section.counters) {
      const name = counterKey(counter)
      if (!name) continue
      if (seen.has(name)) twice.add(name)
      seen.add(name)
    }
  }
  return twice
})

function setInt(row, field, event, nullable) {
  const text = event.target.value
  if (text === '') {
    if (nullable) row[field] = null
    return
  }
  const n = Math.trunc(Number(text))
  if (Number.isFinite(n)) row[field] = n
}

// A colour the sheet names ("red") shown in the colour picker, which only
// takes #rrggbb.
const DEFAULT_COLOR = '#8a2be2'
const hexCache = new Map()
function colorHex(color) {
  if (!color) return DEFAULT_COLOR
  if (/^#[0-9a-f]{6}$/i.test(color)) return color
  if (!hexCache.has(color)) {
    let hex = DEFAULT_COLOR
    try {
      const context = document.createElement('canvas').getContext('2d')
      if (context) {
        context.fillStyle = color
        if (/^#[0-9a-f]{6}$/i.test(context.fillStyle)) hex = context.fillStyle
      }
    } catch {
      // No canvas (tests): the default stands in.
    }
    hexCache.set(color, hex)
  }
  return hexCache.get(color)
}

// Adding focuses what was added, ready to be typed into.
async function focusLast(selector, root = document) {
  await nextTick()
  const fields = root.querySelectorAll(selector)
  fields[fields.length - 1]?.focus()
}

const focusIn = (section, selector) => focusLast(`.sheet-builder [data-section="${keyOf(section)}"] ${selector}`)

function addSection() {
  model.value.sections.push(newSection(''))
  focusLast('.sheet-builder .b-section-title')
}

function removeSection(index) {
  const section = model.value.sections[index]
  const filled = section.counters.length + section.stats.length + section.items.length
  if (filled && !window.confirm(`Delete ${section.title ? `the section "${section.title}"` : 'this section'} and everything in it?`)) return
  model.value.sections.splice(index, 1)
}

function reveal(section) {
  if (isFolded(section)) toggleFold(section)
}

function addCounter(section) {
  reveal(section)
  section.counters.push(newCounter())
  focusIn(section, 'input[aria-label="Counter name"]')
}

function addStats(section) {
  reveal(section)
  section.stats.push(newStatGroup())
  focusIn(section, 'input[aria-label="Stat label"]')
}

function addItem(section) {
  reveal(section)
  section.items.push(newItem())
  focusIn(section, 'input[aria-label="Entry name"]')
}

const pickerOpen = ref(false)
function onPortraitPicked(item) {
  pickerOpen.value = false
  model.value.image = item.image_url
}

// Reordering: drag a row by its handle within its own list, or move it with
// the arrow keys while the handle has focus.
const dragging = ref(null) // { list, index }
const dropTarget = ref(null) // { list, index }: where it would land, 0..length

function move(list, from, to) {
  if (to < 0 || to >= list.length || to === from) return
  const [row] = list.splice(from, 1)
  list.splice(to, 0, row)
}

function dragStart(event, list, index) {
  dragging.value = { list, index }
  event.dataTransfer.effectAllowed = 'move'
  // Firefox won't start a drag without data.
  event.dataTransfer.setData('text/plain', '')
  const row = event.target.closest('.b-row, .b-item, .b-section')
  if (row) event.dataTransfer.setDragImage(row, 16, 16)
}

function dragEnd() {
  dragging.value = null
  dropTarget.value = null
}

function dragOver(event, list, index) {
  if (!dragging.value || dragging.value.list !== list) return
  event.preventDefault()
  event.stopPropagation()
  const box = event.currentTarget.getBoundingClientRect()
  dropTarget.value = { list, index: index + (event.clientY > box.top + box.height / 2 ? 1 : 0) }
}

function drop(event, list) {
  const from = dragging.value
  const target = dropTarget.value
  if (!from || from.list !== list || !target) return
  event.preventDefault()
  event.stopPropagation()
  dragEnd()
  move(list, from.index, target.index > from.index ? target.index - 1 : target.index)
}

function dropClass(list, index) {
  const target = dropTarget.value
  if (!target || target.list !== list) return null
  return {
    'is-dragged': dragging.value?.index === index,
    'is-drop-before': target.index === index,
    'is-drop-after': target.index === list.length && index === list.length - 1
  }
}

async function moveByKey(event, list, index, by) {
  event.preventDefault()
  const to = index + by
  if (to < 0 || to >= list.length) return
  const key = keyOf(list[index])
  move(list, index, to)
  await nextTick()
  document.querySelector(`.sheet-builder [data-handle="${key}"]`)?.focus()
}

// The grip every row and section is dragged by.
const DragHandle = (handleProps) => {
  const { list, index, what } = handleProps
  return h(
    'button',
    {
      type: 'button',
      class: 'b-handle',
      draggable: props.canEdit,
      'data-handle': keyOf(list[index]),
      'aria-label': `Move ${what} (arrow keys)`,
      title: 'Drag to reorder',
      onDragstart: (event) => dragStart(event, list, index),
      onDragend: dragEnd,
      onKeydown: (event) => {
        if (event.key === 'ArrowUp') moveByKey(event, list, index, -1)
        else if (event.key === 'ArrowDown') moveByKey(event, list, index, 1)
      }
    },
    [h('span', { class: 'mdi mdi-drag-vertical' })]
  )
}
DragHandle.props = ['list', 'index', 'what']

const RemoveButton = (removeProps, { attrs }) =>
  h(
    'button',
    {
      ...attrs,
      type: 'button',
      class: 'b-remove rk-icon-btn rk-icon-btn--sm',
      'aria-label': `Delete ${removeProps.what}`,
      title: `Delete ${removeProps.what}`
    },
    [h('span', { class: 'mdi mdi-close' })]
  )
RemoveButton.props = ['what']
// Its click is passed on by hand, not again as a fallthrough attribute.
RemoveButton.inheritAttrs = false
</script>

<style scoped>
.sheet-builder {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  container: builder / inline-size;
  /* Room for the focus rings at the edges. */
  padding: 3px 3px var(--space-4);
  scrollbar-gutter: stable;
}

.builder-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
  margin: 0;
  padding: 0;
  border: none;
}

.b-error {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
  padding: var(--space-2) var(--space-3);
  border: 1px solid rgba(248, 113, 113, 0.35);
  border-radius: var(--radius-md);
  color: var(--status-error);
  font-size: var(--text-sm);
}

.b-card {
  padding: var(--space-3);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg);
  background: var(--surface-raised);
}

.b-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
}

.b-label {
  font-size: var(--text-xs);
  font-weight: 500;
  color: var(--text-secondary);
}

.b-heading {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--text-md);
  font-weight: 600;
  color: var(--text-primary);
}

.b-input {
  width: 100%;
  min-width: 0;
  min-height: var(--control-md);
  padding: 0 var(--space-2);
  border: 1px solid var(--border-medium);
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
  color: var(--text-primary);
  font: inherit;
  font-size: var(--text-sm);
  transition: border-color var(--duration-fast) var(--ease-out), box-shadow var(--duration-fast) var(--ease-out);
}

.b-input--sm {
  min-height: var(--control-sm);
  padding: 0 6px;
}

.b-input::placeholder {
  color: var(--text-muted);
  opacity: 0.6;
}

.b-input:focus-visible {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-a20);
}

.b-input.is-invalid {
  border-color: var(--status-error);
}

.b-input:disabled {
  opacity: 0.7;
}

.b-select {
  width: auto;
  cursor: pointer;
}

.b-num {
  font-variant-numeric: tabular-nums;
  -moz-appearance: textfield;
}

.b-num::-webkit-inner-spin-button {
  display: none;
}

.b-mono {
  font-family: var(--font-mono);
}

.b-textarea {
  min-height: 0;
  padding: var(--space-2);
  resize: vertical;
  line-height: 1.45;
}

.b-inline {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}

.b-check {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--text-xs);
  color: var(--text-secondary);
  cursor: pointer;
}

.b-check input {
  accent-color: var(--accent);
}

.b-check.is-off {
  opacity: 0.5;
  cursor: default;
}

/* Header */
.b-head {
  display: flex;
  gap: var(--space-3);
  align-items: flex-start;
}

.b-portrait {
  position: relative;
  flex: none;
}

.b-portrait-pick {
  display: grid;
  place-items: center;
  width: 76px;
  height: 76px;
  padding: 0;
  overflow: hidden;
  border: 1px dashed var(--border-medium);
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
  color: var(--text-muted);
  font-size: 2rem;
  cursor: pointer;
  transition: border-color var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out);
}

.b-portrait-pick.has-image {
  border-style: solid;
}

.b-portrait-pick:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent-soft);
}

.b-portrait-pick:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.b-portrait-pick img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.b-portrait-clear {
  position: absolute;
  top: -6px;
  right: -6px;
  background: var(--surface-overlay);
  border: 1px solid var(--border-light);
}

.b-head-fields {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

/* Sections */
.b-sections-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  margin-top: var(--space-2);
}

.b-empty {
  margin: 0;
  padding: var(--space-4);
  border: 1px dashed var(--border-light);
  border-radius: var(--radius-lg);
  color: var(--text-secondary);
  font-size: var(--text-sm);
}

.b-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3) var(--space-3);
}

.b-section-head {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}

.b-section-title {
  flex: 1;
  border-color: transparent;
  background: transparent;
  font-family: var(--font-display);
  font-size: var(--text-md);
  font-weight: 600;
}

.b-section-title:hover:not(:focus-visible):not(:disabled) {
  border-color: var(--border-light);
}

.b-section-count {
  flex: none;
  color: var(--text-muted);
  font-size: var(--text-xs);
  white-space: nowrap;
}

.b-section-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.b-section-options {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-4);
  padding-bottom: var(--space-3);
  border-bottom: 1px solid rgba(168, 168, 200, 0.12);
}

.b-tab-input {
  width: 8rem;
}

.b-block {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.b-row-labels {
  color: var(--text-muted);
  font-size: 0.7rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.b-row-labels > span {
  padding-left: 7px;
}

/* One grid per kind of row, so their fields line up under the labels. */
.b-counter-row {
  display: grid;
  grid-template-columns: 1.5rem minmax(5rem, 1fr) 3.4rem 3.4rem 3.4rem 5.6rem 3rem 1.75rem;
  align-items: center;
  gap: var(--space-1);
}

.b-stat-row {
  display: grid;
  grid-template-columns: 1.5rem minmax(5rem, 1.3fr) minmax(4rem, 1fr) minmax(4rem, 1fr) 1.75rem;
  align-items: center;
  gap: var(--space-1);
}

.b-group + .b-group {
  padding-top: var(--space-3);
  border-top: 1px solid rgba(168, 168, 200, 0.12);
}

.b-group-head {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  margin-bottom: var(--space-1);
}

.b-group-title {
  flex: 1;
  font-weight: 600;
}

.b-items {
  gap: var(--space-2);
}

.b-item {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-2);
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
}

.b-item .b-input {
  background: rgba(4, 5, 18, 0.45);
}

.b-item-row {
  display: grid;
  grid-template-columns: 1.5rem minmax(6rem, 1fr) 6.5rem 5.5rem 1.75rem;
  align-items: center;
  gap: var(--space-1);
}

.b-item-name {
  font-weight: 600;
}

.b-item > .b-textarea,
.b-item > .tags-input {
  margin-left: calc(1.5rem + var(--space-1));
  width: calc(100% - 1.5rem - var(--space-1));
}

.b-color {
  position: relative;
  display: inline-flex;
  align-items: center;
}

.b-color-input {
  width: var(--control-sm);
  height: var(--control-sm);
  padding: 2px;
  border: 1px solid var(--border-medium);
  border-radius: var(--radius-sm);
  background: var(--surface-sunken);
  cursor: pointer;
}

.b-color-input.is-default {
  opacity: 0.45;
  border-style: dashed;
}

.b-color-input::-webkit-color-swatch-wrapper {
  padding: 0;
}

.b-color-input::-webkit-color-swatch {
  border: none;
  border-radius: 3px;
}

.b-color-clear {
  display: inline-flex;
  padding: 0;
  border: none;
  background: none;
  color: var(--text-muted);
  font-size: 0.9rem;
  cursor: pointer;
}

.b-color-clear:hover {
  color: var(--text-primary);
}

:deep(.b-handle) {
  display: grid;
  place-items: center;
  width: 1.5rem;
  height: var(--control-sm);
  padding: 0;
  border: none;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--text-muted);
  font-size: 1.1rem;
  cursor: grab;
}

:deep(.b-handle:hover:not(:disabled)) {
  color: var(--text-primary);
  background: var(--hover-tint);
}

:deep(.b-handle:focus-visible) {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

:deep(.b-handle:disabled) {
  visibility: hidden;
}

:deep(.b-remove) {
  color: var(--text-muted);
}

:deep(.b-remove:hover:not(:disabled)) {
  color: var(--status-error);
}

.builder-form:disabled :deep(.b-remove),
.builder-form:disabled .rk-btn--danger,
.builder-form:disabled .b-add,
.builder-form:disabled .b-add-section,
.builder-form:disabled .b-add-row {
  display: none;
}

/* Where a dragged row would land. */
.is-dragged {
  opacity: 0.4;
}

.is-drop-before {
  box-shadow: 0 -2px 0 var(--accent);
}

.is-drop-after {
  box-shadow: 0 2px 0 var(--accent);
}

/* Adding things */
.b-add-row {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  margin-left: calc(1.5rem + var(--space-1));
  padding: 2px var(--space-2);
  border: none;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--text-muted);
  font: inherit;
  font-size: var(--text-xs);
  cursor: pointer;
}

.b-add-row:hover {
  color: var(--accent-soft);
  background: var(--accent-a12);
}

.b-add {
  display: inline-flex;
  align-self: flex-start;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.b-add-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  min-height: var(--control-sm);
  padding: 0 var(--space-3);
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  font-size: var(--text-xs);
  font-weight: 500;
  cursor: pointer;
  transition: background-color var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out);
}

.b-add-btn + .b-add-btn {
  border-left: 1px solid var(--border-light);
}

.b-add-btn:hover {
  background: var(--accent-a12);
  color: var(--text-primary);
}

.b-add-btn:focus-visible,
.b-add-row:focus-visible,
.b-add-section:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

.b-add-section {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  min-height: var(--control-md);
  border: 1px dashed var(--border-medium);
  border-radius: var(--radius-lg);
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  font-size: var(--text-sm);
  font-weight: 500;
  cursor: pointer;
  transition: border-color var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out), background-color var(--duration-fast) var(--ease-out);
}

.b-add-section:hover {
  border-color: var(--accent);
  color: var(--text-primary);
  background: var(--accent-a12);
}

.b-add-section:active,
.b-add-btn:active {
  transform: translateY(1px);
}

.b-description {
  margin-top: var(--space-2);
}

/* A narrow builder (a phone, a half-width pane): the counter's settings go
   under its name. */
@container builder (max-width: 30rem) {
  .b-counter-row {
    grid-template-columns: 1.5rem repeat(3, minmax(0, 1fr)) 1.75rem;
  }

  .b-counter-row > :nth-child(2) {
    grid-column: 2 / 5;
  }

  .b-counter-row > :nth-child(6) {
    grid-column: 2 / 4;
  }

  .b-counter-row > :last-child {
    grid-column: 5;
    grid-row: 1;
  }

  .b-counter-row.b-row-labels {
    display: none;
  }

  .b-stat-row {
    grid-template-columns: 1.5rem minmax(0, 1fr) minmax(0, 1fr) 1.75rem;
  }

  .b-stat-row > :nth-child(4) {
    grid-column: 2 / 4;
  }

  .b-stat-row > :last-child {
    grid-column: 4;
    grid-row: 1;
  }

  .b-stat-row.b-row-labels {
    display: none;
  }

  .b-item-row {
    grid-template-columns: 1.5rem minmax(0, 1fr) minmax(0, 1fr) 1.75rem;
  }

  .b-item-row > .b-item-name {
    grid-column: 2 / 4;
  }

  .b-item-row > :last-child {
    grid-column: 4;
    grid-row: 1;
  }

  .b-section-count {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .b-add-section:active,
  .b-add-btn:active {
    transform: none;
  }
}
</style>
