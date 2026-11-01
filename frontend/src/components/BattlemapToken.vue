<template>
  <g class="token" :class="{ selected, hidden: token.hidden, dragging, ghost }">
    <title>{{ token.name }}</title>
    <clipPath :id="clipId"><circle :r="radius" /></clipPath>
    <circle class="token-body" :r="radius" :fill="token.color || DEFAULT_COLOR" />
    <!-- The art, framed as the token says (zoomed, moved) and turned with it
         (which way it faces); its name and bars don't turn. -->
    <g v-if="token.image_url" :clip-path="`url(#${clipId})`">
      <image
        :href="resolveUrl(token.image_url)"
        :x="frame.x" :y="frame.y" :width="frame.width" :height="frame.height"
        :transform="token.rotation ? `rotate(${token.rotation})` : null"
        preserveAspectRatio="xMidYMid slice"
      />
    </g>
    <text v-else class="token-initials" :font-size="radius * 0.9" text-anchor="middle" dominant-baseline="central">{{ initials(token.name) }}</text>
    <circle class="token-ring" :r="radius" fill="none" :stroke-width="ringWidth" />

    <template v-if="!ghost">
      <g v-for="(meter, i) in token.meters || []" :key="meter.name" class="meter" :transform="`translate(${-radius}, ${radius + meterGap + i * (meterHeight + 2)})`">
        <rect class="meter-back" :width="radius * 2" :height="meterHeight" :rx="meterHeight / 2" />
        <rect class="meter-fill" :width="radius * 2 * meterFill(meter)" :height="meterHeight" :rx="meterHeight / 2" :fill="meter.color || DEFAULT_METER" />
        <title>{{ meter.name }} {{ meter.current }} / {{ meter.max }}</title>
      </g>

      <text v-if="token.name" class="token-label" :font-size="labelSize" :y="-radius - labelSize * 0.35" text-anchor="middle">{{ token.name }}</text>
    </template>
  </g>
</template>

<script>
const DEFAULT_COLOR = '#6d4fc2'
const DEFAULT_METER = '#4ade80'
</script>

<script setup>
import { computed } from 'vue'
import { resolveUrl } from '@/utils/resolveUrl'
import { useImageSize } from '@/composables/useImageSize'
import { initials, meterFill, tokenImageFrame } from '@/utils/battlemapGeometry'

// One token, drawn around (0, 0): whoever places it moves it there. `token`
// is { name, size, rotation, image_url, image_scale, image_x, image_y, color,
// hidden, meters }; `cell` is a cell's side in pixels, which every size
// follows. A `ghost` is where a token is being taken: just its face.
const props = defineProps({
  token: { type: Object, required: true },
  cell: { type: Number, required: true },
  // Unique on the page: clip paths are found by id.
  clipId: { type: String, required: true },
  selected: { type: Boolean, default: false },
  dragging: { type: Boolean, default: false },
  ghost: { type: Boolean, default: false }
})

const ringWidth = computed(() => Math.max(2, props.cell * 0.05))
const labelSize = computed(() => Math.max(10, props.cell * 0.24))
const meterHeight = computed(() => Math.max(4, props.cell * 0.1))
const meterGap = computed(() => Math.max(3, props.cell * 0.06))
const radius = computed(() => Math.max(4, ((props.token.size ?? 1) * props.cell) / 2 - ringWidth.value))
// The image's own proportions, so it is drawn whole, never cut to a square.
const image = useImageSize(() => props.token.image_url)
const aspect = computed(() => (image.width.value && image.height.value ? image.width.value / image.height.value : 1))
const frame = computed(() => tokenImageFrame(props.token, radius.value, aspect.value))
</script>

<style scoped>
.token {
  cursor: pointer;
}

.token.dragging {
  cursor: grabbing;
}

.token-body {
  stroke: rgba(0, 0, 0, 0.5);
  stroke-width: 1;
}

.token-ring {
  stroke: rgba(255, 255, 255, 0.85);
  transition: stroke var(--duration-fast) var(--ease-out);
}

.token.selected .token-ring {
  stroke: var(--accent-soft);
}

.token.selected .token-body {
  filter: drop-shadow(0 0 6px rgba(167, 139, 250, 0.9));
}

/* A hidden token is one only the table sees: dimmed here, absent from screens. */
.token.hidden {
  opacity: 0.45;
}

.token.hidden .token-ring {
  stroke-dasharray: 6 4;
}

/* Being moved: it stays where it is, faint, until it is let go of... */
.token.dragging:not(.ghost) {
  opacity: 0.4;
}

/* ...and its ghost follows the pointer. */
.token.ghost {
  opacity: 0.85;
  pointer-events: none;
}

.token.ghost .token-ring {
  stroke: #fbbf24;
  stroke-dasharray: 6 4;
}

.token-initials {
  fill: #fff;
  font-weight: 700;
  pointer-events: none;
}

.token-label {
  fill: #fff;
  font-weight: 600;
  paint-order: stroke;
  stroke: rgba(0, 0, 0, 0.85);
  stroke-width: 3px;
  stroke-linejoin: round;
  pointer-events: none;
}

.meter-back {
  fill: rgba(0, 0, 0, 0.65);
}

.meter-fill {
  transition: width var(--duration-base) var(--ease-out);
}
</style>
