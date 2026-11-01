<template>
  <div class="battlemap-tools">
    <div class="rail" role="toolbar" aria-label="Tools" aria-orientation="vertical">
      <div v-for="t in tools" :key="t.value" class="slot">
        <button
          type="button"
          class="tool rk-icon-btn"
          :class="{ active: tool === t.value }"
          :aria-pressed="tool === t.value"
          :aria-label="t.label"
          :aria-keyshortcuts="t.key"
          @click="emit('update:tool', t.value)"
        >
          <span class="mdi" :class="t.icon"></span>
          <span class="tip" aria-hidden="true">{{ t.label }} <kbd>{{ t.key.toUpperCase() }}</kbd></span>
        </button>

        <!-- What the area tool draws, next to it while it is the one in hand. -->
        <div v-if="t.value === 'area' && tool === 'area'" class="flyout" role="group" aria-label="Area shape">
          <button
            v-for="s in shapes"
            :key="s.value"
            type="button"
            class="rk-icon-btn rk-icon-btn--sm"
            :class="{ active: areaShape === s.value }"
            :aria-pressed="areaShape === s.value"
            :aria-label="s.label"
            :title="s.label"
            @click="emit('update:areaShape', s.value)"
          >
            <span class="mdi" :class="s.icon"></span>
          </button>
        </div>
      </div>
    </div>

    <!-- How the tool in hand is used: said once, where the eye already is. -->
    <p v-if="hint" class="hint" role="status">
      <span class="mdi" :class="current.icon" aria-hidden="true"></span>
      <span>{{ hint }}</span>
    </p>
  </div>
</template>

<script setup>
import { computed } from 'vue'

// The battlemap's tools, one in hand at a time: a rail on the map's left
// edge, each named on hover with its key, and a line under the map saying how
// the one in hand is used. It changes nothing itself: `update:tool` and
// `update:areaShape` are the editor's to keep.
const props = defineProps({
  // [{ value, label, icon, key, hint }]: the tools this person may use.
  tools: { type: Array, required: true },
  tool: { type: String, required: true },
  // [{ value, label, icon }]: what the area tool can draw.
  shapes: { type: Array, default: () => [] },
  areaShape: { type: String, default: null }
})

const emit = defineEmits(['update:tool', 'update:areaShape'])

const current = computed(() => props.tools.find((t) => t.value === props.tool) || props.tools[0])
const hint = computed(() => current.value?.hint || null)
</script>

<style scoped>
.battlemap-tools {
  pointer-events: none;
  position: absolute;
  inset: 0;
  z-index: var(--z-raised);
}

.rail {
  pointer-events: auto;
  position: absolute;
  top: var(--space-3);
  left: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--space-1);
  background: var(--surface-chrome);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.slot {
  position: relative;
}

.tool {
  position: relative;
  width: 40px;
  height: 40px;
}

.tool.active,
.tool.active:hover {
  background: var(--accent-strong);
  color: var(--accent-contrast);
}

/* The tool's name, beside it on hover or keyboard focus, after a beat so a
   pointer passing over the rail doesn't flash them all. */
.tip {
  position: absolute;
  left: calc(100% + var(--space-3));
  top: 50%;
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
  background: var(--surface-overlay);
  border: 1px solid var(--border-light);
  box-shadow: var(--shadow-md);
  color: var(--text-primary);
  font-size: var(--text-xs);
  font-weight: 500;
  white-space: nowrap;
  opacity: 0;
  transform: translate(-4px, -50%);
  pointer-events: none;
  transition: opacity var(--duration-fast) var(--ease-out), transform var(--duration-fast) var(--ease-out);
}

.tool:hover .tip,
.tool:focus-visible .tip {
  opacity: 1;
  transform: translate(0, -50%);
  transition-delay: 350ms;
}

/* With the shapes open beside it, the area tool's name would cover them. */
.slot:has(.flyout) .tip {
  display: none;
}

kbd {
  min-width: 1.2rem;
  padding: 0 var(--space-1);
  border: 1px solid var(--border-medium);
  border-radius: 4px;
  font-family: var(--font-mono);
  font-size: 0.7rem;
  color: var(--text-secondary);
  text-align: center;
}

.flyout {
  position: absolute;
  left: calc(100% + var(--space-2));
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  gap: 2px;
  padding: var(--space-1);
  background: var(--surface-chrome);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.flyout .active {
  background: var(--accent-a30);
  color: var(--text-primary);
}

.hint {
  position: absolute;
  left: 50%;
  bottom: var(--space-3);
  transform: translateX(-50%);
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  max-width: calc(100% - 2 * var(--space-3) - 7rem);
  margin: 0;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-full);
  background: var(--surface-chrome);
  box-shadow: var(--shadow-md);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  color: var(--text-secondary);
  font-size: var(--text-xs);
}

.hint .mdi {
  flex: none;
  color: var(--accent-soft);
  font-size: 1rem;
}

@media (max-width: 600px) {
  .hint {
    left: var(--space-3);
    right: 7.5rem;
    max-width: none;
    transform: none;
    border-radius: var(--radius-lg);
  }
}
</style>
