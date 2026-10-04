<template>
  <div class="sheet-card" :class="`sheet--${sheet.type}`" @click="onClick" @keydown="onKeydown">
    <header v-if="!compact" class="sheet-head">
      <img v-if="imageSrc" :src="imageSrc" :alt="sheet.name" class="sheet-portrait" />
      <div class="sheet-title">
        <div class="sheet-name">{{ sheet.name }}</div>
        <div class="sheet-meta">
          <span class="sheet-type">{{ TYPE_LABELS[sheet.type] }}</span>
          <span v-if="sheet.subtitle">{{ sheet.subtitle }}</span>
        </div>
        <div v-if="sheet.tags.length" class="sheet-tags">
          <span v-for="tag in sheet.tags" :key="tag" class="sheet-tag">{{ tag }}</span>
        </div>
      </div>
    </header>

    <ul v-if="canInteract && warnings.length" class="sheet-warnings">
      <li v-for="warning in warnings" :key="warning">
        <span class="mdi mdi-alert-outline"></span>{{ warning }}
      </li>
    </ul>

    <!-- Counters gathered by their `group`, in columns once there is room.
         Whoever shows the sheet may draw each one live instead (the `counter`
         slot: a character's saved values). -->
    <div v-if="!compact && resourceGroups.length" class="sheet-resources">
      <div
        v-for="group in resourceGroups"
        :key="group.title ?? ''"
        class="sheet-resource-group"
        :style="{ '--rc-label-width': group.labelWidth }"
      >
        <div v-if="group.title" class="sheet-group-title">{{ group.title }}</div>
        <div class="sheet-resource-grid">
          <slot v-for="r in group.resources" :key="r.name" name="counter" :resource="r">
            <ResourceCounter
              :name="r.name"
              :current="r.start ?? r.max"
              :max="r.max"
              :min="r.min"
              :display="r.style"
              :color="r.color"
            />
          </slot>
        </div>
      </div>
    </div>

    <!-- Each group of stats is its own grid; `columns` fixes how many go in a
         row once there is room for them. -->
    <div v-if="sheet.stats.length" class="sheet-stat-groups">
      <div v-for="(group, g) in sheet.stats" :key="g" class="sheet-stat-group">
        <div v-if="group.title" class="sheet-group-title">{{ group.title }}</div>
        <dl class="sheet-stats" :class="{ 'sheet-grid--fixed': group.columns }" :style="columnsStyle(group.columns)">
          <div v-for="stat in group.stats" :key="stat.label" class="sheet-stat">
            <dt>{{ stat.label }}</dt>
            <dd>
              <button
                v-if="canInteract && isRollable(stat.roll)"
                type="button"
                class="sheet-roll"
                :title="`Roll ${stat.roll}`"
                @click="rollFormula(stat.roll, stat.label)"
              >
                <span class="mdi mdi-dice-multiple"></span>{{ statText(stat) }}
              </button>
              <span v-else>{{ statText(stat) }}</span>
            </dd>
          </div>
        </dl>
      </div>
    </div>

    <div
      v-if="sheet.sections.length"
      class="sheet-sections"
      :class="{ 'sheet-grid--fixed': sheet.columns }"
      :style="columnsStyle(sheet.columns)"
    >
      <!-- A titled section folds (`collapsed` starts it folded); one without a
           title has nothing to fold under. -->
      <component
        :is="section.title ? 'details' : 'section'"
        v-for="(section, index) in sheet.sections"
        :key="index"
        class="sheet-section"
        :class="{ 'sheet-section--wide': section.wide }"
        :open="section.title ? !section.collapsed : undefined"
      >
        <summary v-if="section.title" class="sheet-section-title">
          <span class="mdi mdi-chevron-right sheet-fold-icon" aria-hidden="true"></span>{{ section.title }}
        </summary>
        <ul class="sheet-items" :class="{ 'sheet-grid--fixed': section.columns }" :style="columnsStyle(section.columns)">
          <li
            v-for="(item, i) in section.items"
            :key="i"
            class="sheet-item"
            :class="{ 'sheet-item--row': isRow(item) }"
            :data-roll-label="item.name"
          >
            <div v-if="item.name || item.roll || item.cost || item.tags.length" class="sheet-item-head">
              <span v-if="item.name" class="sheet-item-name">{{ item.name }}</span>
              <span v-if="isRow(item)" class="sheet-item-leader" aria-hidden="true"></span>
              <button
                v-if="canInteract && isRollable(item.roll)"
                type="button"
                class="sheet-roll"
                :title="`Roll ${item.roll}`"
                @click="rollFormula(item.roll, item.name)"
              >
                <span class="mdi mdi-dice-multiple"></span>{{ item.roll }}
              </button>
              <span v-else-if="item.roll" class="sheet-roll-static">{{ item.roll }}</span>
              <span v-if="item.cost" class="sheet-cost">{{ item.cost }}</span>
              <span v-for="tag in item.tags" :key="tag" class="sheet-tag">{{ tag }}</span>
            </div>
            <div v-if="item.text" class="sheet-item-text" v-html="block(item.text)"></div>
          </li>
        </ul>
      </component>
    </div>

    <div v-if="sheet.text && !compact" class="sheet-text" v-html="block(sheet.text)"></div>

    <slot name="footer"></slot>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import ResourceCounter from './ResourceCounter.vue'
import { createMarkdown } from '@/utils/markdown'
import { sanitizeHtml } from '@/utils/sanitizeHtml'
import { parseDiceFormula } from '@/utils/diceNotation'
import { resolveUrl } from '@/utils/resolveUrl'
import { useDiceRoller } from '@/composables/useDiceRoller'

// A sheet, drawn: `sheet` is the normalized shape from utils/sheet.js (or the
// backend's catalog). SheetBlock draws one written in a note; the encounter
// tracker draws a combatant's, `compact` (no header, counters or description:
// the tracker has its own counters).
const props = defineProps({
  sheet: { type: Object, required: true },
  warnings: { type: Array, default: () => [] },
  // Signed in: dice rolls and library images are behind login, like the rest
  // of the app (notes themselves are public).
  canInteract: { type: Boolean, default: false },
  compact: { type: Boolean, default: false }
})

const TYPE_LABELS = { character: 'Character', adversary: 'Adversary' }

const router = useRouter()
const { roll } = useDiceRoller()
const md = createMarkdown({ refKinds: ['dice'] })

// Groups in the order they first appear; counters without one form an
// untitled group of their own. Each group's labels share one width (its
// longest, within reason) so the pips line up.
const resourceGroups = computed(() => {
  const groups = new Map()
  for (const [name, spec] of Object.entries(props.sheet.resources || {})) {
    const key = spec.group ?? null
    if (!groups.has(key)) groups.set(key, { title: key, resources: [] })
    groups.get(key).resources.push({ name, ...spec })
  }
  return [...groups.values()].map((group) => ({
    ...group,
    labelWidth: `${Math.min(16, Math.max(4.5, ...group.resources.map((r) => r.name.length * 0.55 + 0.5)))}em`
  }))
})

// An item that is only a name and a roll (a skill, a save) reads as one row,
// the roll at the end like on a paper sheet.
const isRow = (item) => !item.text && !!item.name && !!item.roll

const imageSrc = computed(() => {
  const image = props.sheet.image
  if (!image) return null
  return image.startsWith('/api/asset-library/') && !props.canInteract ? null : resolveUrl(image)
})

const isRollable = (formula) => !!formula && !!parseDiceFormula(formula)
const statText = (stat) => stat.value ?? stat.roll

// Texts are block markdown, so a table or a list works in an item too.
const block = (text) => sanitizeHtml(md.render(text))
const columnsStyle = (columns) => (columns ? { '--sheet-columns': columns } : null)

function rollFormula(formula, label) {
  roll(formula, { label: label ? `${props.sheet.name} · ${label}` : props.sheet.name })
}

// Dice written inside a text (`1d8+2`) and links to other notes come out of
// v-html, so they are handled here instead of with their own listeners.
function onActivate(e) {
  const dice = e.target.closest('[data-dice-formula]')
  if (!dice) return false
  e.preventDefault()
  if (props.canInteract) {
    rollFormula(dice.getAttribute('data-dice-formula'), dice.closest('[data-roll-label]')?.getAttribute('data-roll-label'))
  }
  return true
}

function onClick(e) {
  if (onActivate(e)) return
  const link = e.target.closest('a[href^="/note/"]')
  if (!link || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
  if (router) {
    e.preventDefault()
    router.push(link.getAttribute('href'))
  }
}

function onKeydown(e) {
  if (e.key === 'Enter' || e.key === ' ') onActivate(e)
}
</script>

<style scoped>
.sheet-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  margin: var(--space-4) 0;
  padding: var(--space-4);
  /* The layouts below (columns of stats, sections, items) follow the card's
     width, not the window's: the same sheet sits in a note and in the
     encounter tracker. */
  container: sheet / inline-size;
  background: var(--surface-raised);
  border: 1px solid var(--accent-a30);
  border-left: 4px solid var(--accent);
  border-radius: var(--radius-lg);
  font-size: var(--text-base);
  line-height: var(--leading-normal);
}

.sheet--character {
  border-left-color: var(--status-success);
}

.sheet-head {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

.sheet-portrait {
  flex: none;
  width: 72px;
  height: 72px;
  object-fit: cover;
  border-radius: var(--radius-md);
  border: 1px solid var(--accent-a45);
}

.sheet-title {
  min-width: 0;
}

.sheet-name {
  font-family: var(--font-display);
  font-size: var(--text-xl);
  font-weight: 700;
  line-height: var(--leading-tight);
  color: var(--text-primary);
}

.sheet-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  color: var(--text-secondary);
  font-size: var(--text-sm);
}

.sheet-type {
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--accent-soft);
}

.sheet--character .sheet-type {
  color: var(--status-success);
}

.sheet-tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  margin-top: var(--space-1);
}

.sheet-tag {
  padding: 0 var(--space-2);
  border-radius: var(--radius-full);
  border: 1px solid var(--accent-a30);
  background: var(--accent-a12);
  color: var(--accent-soft);
  font-size: var(--text-xs);
  line-height: 1.6;
}

.sheet-card .sheet-warnings {
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: var(--text-sm);
  color: var(--status-warning);
}

.sheet-warnings .mdi {
  margin-right: var(--space-1);
}

.sheet-resources {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.sheet-resource-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 20rem), 1fr));
  gap: var(--space-1) var(--space-5);
}

/* One label width per group, so its pips and bars start in line. */
.sheet-resource-group :deep(.rc-name) {
  flex: none;
  width: var(--rc-label-width);
  min-width: 0;
}

.sheet-stat-groups {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

/* An untitled group after another is told apart by a rule. */
.sheet-stat-group + .sheet-stat-group:not(:has(> .sheet-group-title)) {
  padding-top: var(--space-3);
  border-top: 1px dashed var(--border-light);
}

.sheet-group-title {
  margin-bottom: var(--space-1);
  font-size: var(--text-xs);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-muted);
}

.sheet-stats {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(7.5rem, 1fr));
  gap: var(--space-2);
  margin: 0;
}

/* `columns` in the sheet: as many as asked once the card is wide enough to
   fit them, the automatic layout below that. */
@container sheet (min-width: 40rem) {
  .sheet-stats.sheet-grid--fixed {
    grid-template-columns: repeat(var(--sheet-columns), minmax(0, 1fr));
  }
}

.sheet-sections {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

@container sheet (min-width: 44rem) {
  .sheet-sections.sheet-grid--fixed {
    display: grid;
    grid-template-columns: repeat(var(--sheet-columns), minmax(0, 1fr));
    gap: var(--space-3) var(--space-5);
    align-items: start;
  }

  .sheet-section--wide {
    grid-column: 1 / -1;
  }
}

.sheet-section {
  min-width: 0;
  container: sheet-section / inline-size;
}

.sheet-stat {
  padding: var(--space-2) var(--space-3);
  background: var(--surface-sunken);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
}

.sheet-stat dt {
  font-size: var(--text-xs);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
}

.sheet-stat dd {
  margin: 0;
  font-weight: 600;
  color: var(--text-primary);
}

.sheet-roll {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0 var(--space-2);
  min-height: 1.6rem;
  border: 1px solid var(--accent-a45);
  border-radius: var(--radius-sm);
  background: var(--accent-a20);
  color: var(--accent-soft);
  font: inherit;
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  cursor: pointer;
  transition:
    background-color var(--duration-fast) var(--ease-out),
    border-color var(--duration-fast) var(--ease-out);
}

.sheet-roll:hover {
  background: var(--accent-a45);
  border-color: var(--accent);
}

.sheet-roll-static {
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  color: var(--text-secondary);
}

.sheet-section-title {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  margin-bottom: var(--space-1);
  padding-bottom: var(--space-1);
  border-bottom: 1px solid var(--border-light);
  font-size: var(--text-sm);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--accent-soft);
  list-style: none;
  cursor: pointer;
  user-select: none;
}

.sheet-section-title::-webkit-details-marker {
  display: none;
}

.sheet-section-title:hover {
  color: var(--text-primary);
}

.sheet-fold-icon {
  margin-left: -0.2em;
  font-size: 1.2em;
  line-height: 1;
  transition: transform var(--duration-fast) var(--ease-out);
}

.sheet-section[open] > .sheet-section-title .sheet-fold-icon {
  transform: rotate(90deg);
}

.sheet-section:not([open]) > .sheet-section-title {
  margin-bottom: 0;
}

.sheet-card .sheet-items {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.sheet-card .sheet-item {
  margin: 0;
  min-width: 0;
}

@container sheet-section (min-width: 20rem) {
  .sheet-card .sheet-items.sheet-grid--fixed {
    display: grid;
    grid-template-columns: repeat(var(--sheet-columns), minmax(0, 1fr));
    gap: var(--space-2) var(--space-4);
  }
}

.sheet-item-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

/* A name-and-roll item as one row: name and tags, a dotted leader, the roll
   at the end. */
.sheet-item--row .sheet-item-head {
  gap: var(--space-1);
}

.sheet-item--row .sheet-item-name {
  order: 0;
}

.sheet-item--row .sheet-tag {
  order: 1;
  flex: none;
  font-size: 0.7rem;
}

.sheet-item-leader {
  order: 2;
  flex: 1 1 1rem;
  min-width: 1rem;
  align-self: flex-end;
  margin-bottom: 0.45em;
  border-bottom: 1px dotted var(--border-medium);
}

.sheet-item--row .sheet-cost {
  order: 3;
  flex: none;
}

/* When the row is too narrow, the roll wraps to the next line, still at the
   end. */
.sheet-item--row :is(.sheet-roll, .sheet-roll-static) {
  order: 4;
  flex: none;
  margin-left: auto;
}

.sheet-item-name {
  font-weight: 700;
  color: var(--text-primary);
}

.sheet-cost {
  font-size: var(--text-sm);
  color: var(--status-warning);
}

.sheet-item-text,
.sheet-text {
  color: var(--text-secondary);
}

.sheet-card .sheet-item-text :deep(:is(p, ul, ol)),
.sheet-card .sheet-text :deep(:is(p, ul, ol)) {
  margin: 0 0 var(--space-2);
  max-width: none;
}

.sheet-card .sheet-item-text :deep(:last-child),
.sheet-card .sheet-text :deep(:last-child) {
  margin-bottom: 0;
}

/* Tables written in a text (Markdown `| a | b |`). The note styles its own
   tables too; this is for the sheet anywhere else (the encounter tracker). */
.sheet-card :deep(table) {
  width: 100%;
  margin: 0 0 var(--space-2);
  border-collapse: collapse;
  font-size: var(--text-sm);
}

.sheet-card :deep(th),
.sheet-card :deep(td) {
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--border-light);
  text-align: left;
  vertical-align: top;
}

.sheet-card :deep(th) {
  background: var(--surface-sunken);
  color: var(--text-primary);
  font-weight: 600;
}

/* The note around a sheet styles every ul / li / p in it (NoteView's
   .markdown-content), so the sheet's own rules above are written to outweigh
   those. */

/* The same look as a dice formula written in a note (NoteView). */
.sheet-card :deep(code.dice-roll) {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.1em 0.4em;
  border-radius: var(--radius-sm);
  border: 1px solid var(--accent-a45);
  background: var(--accent-a20);
  color: var(--accent-soft);
  font-family: var(--font-mono);
  font-size: 0.875em;
  cursor: pointer;
}

.sheet-card :deep(code.dice-roll:hover) {
  background: var(--accent-a45);
  border-color: var(--accent);
}
</style>
