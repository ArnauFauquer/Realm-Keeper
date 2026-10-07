<template>
  <section class="area-inspector" :aria-label="`Area: ${area.label || SHAPE_LABELS[area.shape]}`">
    <header class="head">
      <input class="rk-input" maxlength="60" :value="area.label" :placeholder="SHAPE_LABELS[area.shape]" :disabled="disabled" aria-label="Area name" @change="emit('patch', { label: $event.target.value.trim() })" />
      <button type="button" class="rk-icon-btn rk-icon-btn--sm danger" :disabled="disabled" aria-label="Remove area" title="Remove area" @click="emit('remove')">
        <span class="mdi mdi-trash-can-outline"></span>
      </button>
    </header>

    <div class="shapes" role="group" aria-label="Shape">
      <button
        v-for="s in AREA_SHAPES"
        :key="s.value"
        type="button"
        class="rk-icon-btn rk-icon-btn--sm"
        :class="{ active: area.shape === s.value }"
        :aria-pressed="area.shape === s.value"
        :title="s.label"
        :aria-label="s.label"
        :disabled="disabled"
        @click="emit('patch', { shape: s.value })"
      >
        <span class="mdi" :class="s.icon"></span>
      </button>
      <span class="measure">{{ areaMeasure(grid, area) }}</span>
    </div>

    <div class="row">
      <label class="field">
        <span>{{ sizeLabel }} (cells)</span>
        <input class="rk-input" type="number" min="0.5" max="1000" step="0.5" :value="area.size" :disabled="disabled" @change="emit('patch', { size: clamp($event.target.value, 0.1, 1000, area.size) })" />
      </label>
      <label v-if="area.shape === 'cone' || area.shape === 'line'" class="field">
        <span>Direction (°)</span>
        <input class="rk-input" type="number" step="15" :value="area.angle" :disabled="disabled" @change="emit('patch', { angle: clamp($event.target.value, -3600, 3600, area.angle) })" />
      </label>
      <label v-if="area.shape === 'cone'" class="field">
        <span>Opening (°)</span>
        <input class="rk-input" type="number" min="5" max="360" step="5" :value="area.spread" :disabled="disabled" @change="emit('patch', { spread: clamp($event.target.value, 5, 360, area.spread) })" />
      </label>
      <label v-if="area.shape === 'line'" class="field">
        <span>Width (cells)</span>
        <input class="rk-input" type="number" min="0.5" step="0.5" :value="area.width" :disabled="disabled" @change="emit('patch', { width: clamp($event.target.value, 0.1, 1000, area.width) })" />
      </label>
    </div>

    <div class="swatches" role="group" aria-label="Area colour">
      <button
        v-for="c in AREA_COLORS"
        :key="c"
        type="button"
        class="swatch"
        :class="{ active: (area.color || AREA_COLORS[0]) === c }"
        :style="{ background: c }"
        :aria-label="`Colour ${c}`"
        :disabled="disabled"
        @click="emit('patch', { color: c })"
      ></button>
    </div>

    <label class="check">
      <input type="checkbox" :checked="area.hidden" :disabled="disabled" @change="emit('patch', { hidden: $event.target.checked })" />
      <span>Hidden from the screen</span>
    </label>
  </section>
</template>

<script>
/** The shapes an area can take, as the area tool and this offer them. */
export const AREA_SHAPES = [
  { value: 'circle', label: 'Circle', icon: 'mdi-circle-outline' },
  { value: 'cone', label: 'Cone', icon: 'mdi-cone' },
  { value: 'line', label: 'Line', icon: 'mdi-vector-line' },
  { value: 'square', label: 'Square', icon: 'mdi-square-outline' }
]
</script>

<script setup>
import { computed } from 'vue'
import { AREA_COLORS } from '@/utils/palette'
import { areaMeasure } from '@/utils/battlemapGeometry'

// One area of a battlemap (backend models/battlemap.py Area): its name, shape,
// reach, direction, colour and whether the screen sees it. It changes
// nothing itself: `patch` (the fields to change) and `remove` are for the
// map to apply.
const props = defineProps({
  area: { type: Object, required: true },
  grid: { type: Object, required: true },
  disabled: { type: Boolean, default: false }
})

const emit = defineEmits(['patch', 'remove'])

const SHAPE_LABELS = Object.fromEntries(AREA_SHAPES.map((s) => [s.value, s.label]))
const sizeLabel = computed(() => ({ circle: 'Radius', square: 'From the centre' }[props.area.shape] || 'Length'))

function clamp(value, low, high, fallback) {
  const n = Number(value)
  return Number.isFinite(n) && value !== '' ? Math.min(high, Math.max(low, n)) : fallback
}
</script>

<style scoped>
.area-inspector {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-3);
  background: var(--surface-sunken);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg);
}

.head {
  display: flex;
  gap: var(--space-2);
}

.head input {
  flex: 1;
}

.shapes {
  display: flex;
  align-items: center;
  gap: 2px;
}

.shapes .active {
  background: var(--accent-a30);
  color: var(--text-primary);
}

.measure {
  margin-left: auto;
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-secondary);
}

.row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  flex: 1;
  min-width: 5.5rem;
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.swatches {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}

.swatch {
  width: 1.4rem;
  height: 1.4rem;
  border: 2px solid transparent;
  border-radius: var(--radius-full);
  cursor: pointer;
}

.swatch.active {
  border-color: #fff;
}

.check {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-sm);
  color: var(--text-secondary);
}
</style>
