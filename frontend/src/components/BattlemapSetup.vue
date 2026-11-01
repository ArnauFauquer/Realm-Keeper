<template>
  <div class="battlemap-setup">
    <section class="block" aria-labelledby="setup-map">
      <h3 id="setup-map" class="block-title">Map</h3>
      <button type="button" class="map-image" :disabled="disabled" @click="emit('choose-image')">
        <img v-if="imageSrc" :src="imageSrc" alt="" />
        <span v-else class="mdi mdi-image-outline" aria-hidden="true"></span>
        <span class="map-image-label">
          <span class="mdi mdi-image-edit-outline" aria-hidden="true"></span>
          {{ map.image_url ? 'Change the image' : 'Choose an image' }}
        </span>
      </button>

      <div class="field">
        <label for="setup-encounter">Encounter</label>
        <div class="row">
          <select id="setup-encounter" class="rk-input grow" :value="map.encounter || ''" :disabled="disabled" @change="emit('set-encounter', $event.target.value)">
            <option value="">None</option>
            <option v-for="e in encounters" :key="e.id" :value="e.id">{{ e.id.includes('/') ? e.id : e.name }}</option>
          </select>
          <button v-if="!map.encounter && !disabled" type="button" class="rk-btn" :disabled="creatingEncounter" @click="emit('create-encounter')">
            <span class="mdi mdi-plus"></span> New
          </button>
        </div>
        <p class="note">Whose sheets are played from the map, and whose counters its tokens show.</p>
      </div>
    </section>

    <section class="block" aria-labelledby="setup-grid">
      <h3 id="setup-grid" class="block-title">Grid</h3>
      <div class="segmented" role="radiogroup" aria-label="Grid">
        <button
          v-for="o in GRID_TYPES"
          :key="o.value"
          type="button"
          role="radio"
          :aria-checked="grid.type === o.value"
          :class="{ active: grid.type === o.value }"
          :disabled="disabled"
          @click="patch({ type: o.value })"
        >{{ o.label }}</button>
      </div>

      <template v-if="grid.type === 'square'">
        <div class="cols">
          <label class="field">
            <span>Cell (px)</span>
            <input class="rk-input" type="number" min="4" max="2000" :value="grid.size" :disabled="disabled" @change="patch({ size: clamp($event.target.value, 4, 2000) })" />
          </label>
          <label class="field">
            <span>Offset X</span>
            <input class="rk-input" type="number" :value="grid.offset_x" :disabled="disabled" @change="patch({ offset_x: num($event.target.value) })" />
          </label>
          <label class="field">
            <span>Offset Y</span>
            <input class="rk-input" type="number" :value="grid.offset_y" :disabled="disabled" @change="patch({ offset_y: num($event.target.value) })" />
          </label>
        </div>

        <label class="switch">
          <input type="checkbox" role="switch" :checked="grid.snap" :disabled="disabled" @change="patch({ snap: $event.target.checked })" />
          <span class="switch-track" aria-hidden="true"></span>
          <span>Snap tokens to cells</span>
        </label>
        <label class="switch">
          <input type="checkbox" role="switch" :checked="grid.visible" :disabled="disabled" @change="patch({ visible: $event.target.checked })" />
          <span class="switch-track" aria-hidden="true"></span>
          <span>Show the lines</span>
        </label>
        <label v-if="grid.visible" class="field">
          <span>Line opacity</span>
          <input type="range" min="0" max="1" step="0.05" :value="grid.opacity" :disabled="disabled" @change="patch({ opacity: Number($event.target.value) })" />
        </label>
      </template>
    </section>

    <section class="block" aria-labelledby="setup-distance">
      <h3 id="setup-distance" class="block-title">Distance</h3>
      <div class="cols cols--2">
        <label class="field">
          <span>One cell is</span>
          <input class="rk-input" type="number" min="0.01" step="any" :value="grid.distance" :disabled="disabled" @change="patch({ distance: positive($event.target.value, grid.distance) })" />
        </label>
        <label class="field">
          <span>Unit</span>
          <input class="rk-input" maxlength="20" :value="grid.unit" :disabled="disabled" @change="patch({ unit: $event.target.value.trim() || 'cell' })" />
        </label>
      </div>

      <div class="field">
        <span id="setup-measure">The ruler counts</span>
        <div class="segmented" role="radiogroup" aria-labelledby="setup-measure">
          <button
            v-for="o in MEASURES"
            :key="o.value"
            type="button"
            role="radio"
            :aria-checked="grid.measure === o.value"
            :class="{ active: grid.measure === o.value }"
            :title="o.title"
            :disabled="disabled"
            @click="patch({ measure: o.value })"
          >{{ o.label }}</button>
        </div>
        <p v-if="grid.measure !== 'bands'" class="note">{{ MEASURES.find((o) => o.value === grid.measure)?.title }}</p>
      </div>

      <RangeBandsEditor
        v-if="grid.measure === 'bands'"
        :bands="grid.bands || []"
        :unit="grid.unit"
        :disabled="disabled"
        @change="(bands) => patch({ bands })"
      />
      <p v-if="grid.measure === 'bands' && grid.snap && grid.type === 'square'" class="note">
        For free movement, turn off <em>Snap tokens to cells</em> above.
      </p>
    </section>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import RangeBandsEditor from './RangeBandsEditor.vue'
import { resolveUrl } from '@/utils/resolveUrl'

// How a battlemap is set up, once, before it is played on: its image, its
// encounter, its grid and how distances are counted. It changes nothing
// itself: `patch-grid` (the grid's fields to change), `set-encounter` (an id,
// or '' for none), `create-encounter` and `choose-image` are the map's.
const props = defineProps({
  map: { type: Object, required: true },
  encounters: { type: Array, default: () => [] },
  creatingEncounter: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false }
})

const emit = defineEmits(['patch-grid', 'set-encounter', 'create-encounter', 'choose-image'])

const GRID_TYPES = [{ value: 'square', label: 'Square' }, { value: 'none', label: 'None' }]
const MEASURES = [
  { value: 'grid', label: 'Cells', title: 'Counts cells; a diagonal step is one.' },
  { value: 'straight', label: 'Straight', title: 'Measures the straight line.' },
  { value: 'bands', label: 'Ranges', title: 'Names the range a distance falls in.' }
]

const grid = computed(() => props.map.grid)
const imageSrc = computed(() => (props.map.image_url ? resolveUrl(props.map.image_url) : null))

const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0)
const clamp = (value, low, high) => Math.min(high, Math.max(low, num(value)))
const positive = (value, fallback) => (num(value) > 0 ? num(value) : fallback)
const patch = (fields) => emit('patch-grid', fields)
</script>

<style scoped>
.battlemap-setup {
  display: flex;
  flex-direction: column;
}

.block {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4) 0;
  border-top: 1px solid var(--border-light);
}

.block:first-child {
  padding-top: 0;
  border-top: none;
}

.block-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-primary);
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.row {
  display: flex;
  gap: var(--space-2);
}

.grow {
  flex: 1;
  min-width: 0;
}

.cols {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-2);
}

.cols--2 {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.note {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--text-muted);
}

/* The image, as a button that changes it. */
.map-image {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 7.5rem;
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg);
  background: var(--surface-sunken);
  color: var(--text-muted);
  cursor: pointer;
}

.map-image:disabled {
  cursor: default;
}

.map-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0.75;
  transition: opacity var(--duration-fast) var(--ease-out);
}

.map-image > .mdi {
  font-size: 2rem;
}

.map-image-label {
  position: absolute;
  left: var(--space-2);
  bottom: var(--space-2);
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
  background: var(--surface-overlay);
  color: var(--text-primary);
  font-size: var(--text-xs);
  font-weight: 500;
}

.map-image:hover:not(:disabled) img {
  opacity: 1;
}

.map-image:disabled .map-image-label {
  display: none;
}

.segmented {
  display: flex;
  padding: 2px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
}

.segmented button {
  flex: 1;
  min-height: var(--control-sm);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  font-size: var(--text-xs);
  font-weight: 500;
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out);
}

.segmented button:hover:not(:disabled) {
  color: var(--text-primary);
}

.segmented button.active {
  background: var(--accent-strong);
  color: var(--accent-contrast);
}

/* A checkbox drawn as a switch: on or off, at a glance. */
.switch {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  font-size: var(--text-sm);
  color: var(--text-secondary);
  cursor: pointer;
}

.switch input {
  position: absolute;
  opacity: 0;
  width: 1px;
  height: 1px;
}

.switch-track {
  position: relative;
  flex: none;
  width: 2.1rem;
  height: 1.2rem;
  border-radius: var(--radius-full);
  background: var(--surface-sunken);
  border: 1px solid var(--border-medium);
  transition: background var(--duration-fast) var(--ease-out);
}

.switch-track::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 2px;
  width: 0.85rem;
  height: 0.85rem;
  border-radius: var(--radius-full);
  background: var(--text-secondary);
  transform: translateY(-50%);
  transition: transform var(--duration-fast) var(--ease-out), background var(--duration-fast) var(--ease-out);
}

.switch input:checked + .switch-track {
  background: var(--accent-strong);
  border-color: var(--accent-strong);
}

.switch input:checked + .switch-track::after {
  background: var(--accent-contrast);
  transform: translate(0.9rem, -50%);
}

.switch input:focus-visible + .switch-track {
  outline: 2px solid var(--accent-hover);
  outline-offset: 2px;
}

.switch input:disabled + .switch-track {
  opacity: 0.5;
}
</style>
