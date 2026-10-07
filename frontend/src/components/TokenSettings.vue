<template>
  <div class="token-settings">
    <label class="field">
      <span>Name on the map</span>
      <input class="rk-input" maxlength="60" :value="token.name" :disabled="disabled" @change="emit('patch', { name: $event.target.value.trim() })" />
    </label>

    <div class="look">
      <div class="field">
        <span>Colour</span>
        <div class="swatches" role="group" aria-label="Token colour">
          <button
            v-for="c in TOKEN_COLORS"
            :key="c"
            type="button"
            class="swatch"
            :class="{ active: (token.color || TOKEN_COLORS[0]) === c }"
            :style="{ background: c }"
            :aria-label="`Colour ${c}`"
            :aria-pressed="(token.color || TOKEN_COLORS[0]) === c"
            :disabled="disabled"
            @click="emit('patch', { color: c })"
          ></button>
        </div>
      </div>
      <div class="field size">
        <span id="token-size-label">Size</span>
        <div class="stepper" role="group" aria-labelledby="token-size-label">
          <button type="button" class="rk-icon-btn rk-icon-btn--sm" :disabled="disabled || token.size <= MIN_SIZE" aria-label="Smaller" @click="resize(-SIZE_STEP)">
            <span class="mdi mdi-minus"></span>
          </button>
          <output class="size-value">{{ token.size }}<small>{{ token.size === 1 ? ' cell' : ' cells' }}</small></output>
          <button type="button" class="rk-icon-btn rk-icon-btn--sm" :disabled="disabled || token.size >= MAX_SIZE" aria-label="Bigger" @click="resize(SIZE_STEP)">
            <span class="mdi mdi-plus"></span>
          </button>
        </div>
      </div>
    </div>

    <div class="field">
      <span>Picture</span>
      <TokenImageEditor
        v-if="token.image_url"
        :image-url="token.image_url"
        :scale="token.image_scale ?? 1"
        :x="token.image_x ?? 0"
        :y="token.image_y ?? 0"
        :rotation="token.rotation ?? 0"
        :color="token.color"
        :disabled="disabled"
        @change="(fields) => emit('patch', fields)"
      />
      <div class="row">
        <button type="button" class="rk-btn rk-btn--sm" :disabled="disabled" @click="emit('choose-image')">
          <span class="mdi mdi-image-outline"></span> {{ token.image_url ? 'Change picture' : 'Choose a picture' }}
        </button>
        <button v-if="token.image_url" type="button" class="rk-btn rk-btn--sm rk-btn--ghost" :disabled="disabled" @click="emit('patch', { image_url: null })">
          Remove
        </button>
      </div>
    </div>

    <div v-if="counters.length" class="field">
      <span>Counters shown on the token</span>
      <div class="chips" role="group" aria-label="Counters shown on the token">
        <button
          v-for="name in counters"
          :key="name"
          type="button"
          class="chip"
          :class="{ active: shows(name) }"
          :aria-pressed="shows(name)"
          :disabled="disabled"
          @click="emit('toggle-bar', name, !shows(name))"
        >
          <span class="mdi" :class="shows(name) ? 'mdi-check' : 'mdi-plus'" aria-hidden="true"></span>{{ name }}
        </button>
      </div>
    </div>

    <label v-if="combatants" class="field">
      <span>Stands for</span>
      <select class="rk-input" :value="token.combatant || ''" :disabled="disabled" @change="emit('link', $event.target.value)">
        <option value="">No one</option>
        <option v-for="c in combatants" :key="c.id" :value="c.id">{{ c.name }}</option>
      </select>
    </label>

    <button v-if="!disabled" type="button" class="rk-btn rk-btn--sm rk-btn--ghost rk-btn--danger remove" @click="emit('remove')">
      <span class="mdi mdi-trash-can-outline"></span> Remove from the map
    </button>
  </div>
</template>

<script setup>
import { TOKEN_COLORS } from '@/utils/palette'
import TokenImageEditor from './TokenImageEditor.vue'

// How one token looks on the map and who it stands for: its name, colour,
// size, picture, the counters drawn under it. It changes nothing itself:
// `patch` (the fields to change), `toggle-bar` (a counter's name, shown or
// not), `link` (a combatant's id, or '' for no one), `choose-image` and
// `remove` are for the map to apply.
const props = defineProps({
  token: { type: Object, required: true },
  // The names of the counters it could show (utils/battlemapMeters.js barOptions).
  counters: { type: Array, default: () => [] },
  // Whom it could stand for: the map's encounter's combatants, or null with none.
  combatants: { type: Array, default: null },
  disabled: { type: Boolean, default: false }
})

const emit = defineEmits(['patch', 'toggle-bar', 'link', 'choose-image', 'remove'])

const MIN_SIZE = 0.5
const MAX_SIZE = 20
const SIZE_STEP = 0.5

const shows = (name) => !!props.token.show_bars && (props.token.bars || []).includes(name)

function resize(by) {
  const size = Math.min(MAX_SIZE, Math.max(MIN_SIZE, (props.token.size || 1) + by))
  if (size !== props.token.size) emit('patch', { size })
}
</script>

<style scoped>
.token-settings {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.look {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.size {
  align-items: flex-start;
}

.swatches {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}

.swatch {
  width: 1.5rem;
  height: 1.5rem;
  border: 2px solid transparent;
  border-radius: var(--radius-full);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.15);
  cursor: pointer;
  transition: transform var(--duration-fast) var(--ease-out);
}

.swatch:hover:not(:disabled) {
  transform: scale(1.1);
}

.swatch.active {
  border-color: var(--text-primary);
}

.stepper {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: 2px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
}

.size-value {
  min-width: 4.5rem;
  text-align: center;
  font-size: var(--text-sm);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}

.size-value small {
  font-weight: 400;
  color: var(--text-muted);
}

.row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: 2px var(--space-3) 2px var(--space-2);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  font-size: var(--text-xs);
  cursor: pointer;
  transition: border-color var(--duration-fast) var(--ease-out), background var(--duration-fast) var(--ease-out);
}

.chip:hover:not(:disabled) {
  border-color: var(--border-medium);
  color: var(--text-primary);
}

.chip.active {
  border-color: var(--accent);
  background: var(--accent-a12);
  color: var(--text-primary);
}

.remove {
  align-self: flex-start;
}
</style>
