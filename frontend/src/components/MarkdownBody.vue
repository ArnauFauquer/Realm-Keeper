<template>
  <!-- Filled by paint(), not v-html: the HTML is replaced (and its embeds,
       buttons and diagrams set up again) whenever it or the signed-in user
       changes, including when this is mounted again with the same HTML. -->
  <article
    ref="root"
    class="markdown-content"
    @click="onClick"
    @keydown="onKeydown"
    @mouseover="onMouseover"
  ></article>
</template>

<script setup>
/**
 * Rendered markdown (a note, or the editor's preview of one) made live:
 * note links route inside the app, chart/vista/sheet placeholders become
 * components, mermaid blocks are drawn, and, for someone signed in, dice,
 * roll tables, songs and sound effects play and images get a "Screen"
 * button. One click and one keydown listener on the container handle all of
 * it, so nothing has to be wired again after the HTML changes.
 */
import { getCurrentInstance, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '@/composables/useAuth'
import { useSoundEffects } from '@/composables/useSoundEffects'
import { createDocEmbeds } from '@/composables/useDocEmbeds'
import { findInlineAction, runInlineAction, syncSfxButtons } from '@/composables/useInlineActions'
import { wrapImagesForScreen } from '@/composables/useImageScreenButtons'
import { renderMermaidIn } from '@/composables/useMermaid'
import { hasMermaid } from '@/utils/renderNote'
import { noteIdFromHref } from '@/utils/noteUrls'

const props = defineProps({
  // Sanitized HTML, from utils/renderNote.js.
  html: { type: String, default: '' },
  // The note's title: a sheet named like it (or like a heading) hides its name.
  pageTitle: { type: String, default: '' }
})

const emit = defineEmits([
  // A note link is hovered: its note id, to prefetch.
  'link-hover',
  // The HTML is in the page (its headings can be scrolled to).
  'rendered'
])

const root = ref(null)
const router = useRouter()
const { user } = useAuth()
const { playing: sfxPlaying } = useSoundEffects()
const embeds = createDocEmbeds(getCurrentInstance().appContext)

// Bumped on each paint, so a diagram still loading for older HTML stops.
let generation = 0

function paint() {
  const el = root.value
  if (!el) return
  const current = ++generation
  const signedIn = !!user.value

  embeds.unmountAll()
  el.innerHTML = props.html

  const pageHeadings = [props.pageTitle, ...[...el.querySelectorAll('h1, h2, h3')].map((h) => h.textContent)]
  embeds.mountAll(el, { canInteract: signedIn, pageHeadings })
  if (signedIn) {
    wrapImagesForScreen(el)
    syncSfxButtons(el, sfxPlaying)
  }
  if (hasMermaid(props.html)) renderMermaidIn(el, () => current === generation)
  emit('rendered', el)
}

onMounted(paint)
watch([() => props.html, () => !!user.value], paint)
watch(sfxPlaying, () => { if (root.value && user.value) syncSfxButtons(root.value, sfxPlaying) }, { deep: true })

onBeforeUnmount(() => {
  generation++
  embeds.unmountAll()
})

function onClick(e) {
  const action = findInlineAction(e.target, root.value)
  if (!action) return

  if (action.kind === 'note-link') {
    // Plain <a> from the HTML isn't a <router-link>, so a click would
    // otherwise trigger a full page navigation (reloading the app and
    // killing audio playback). Route it through Vue Router instead,
    // unless the user wants the browser's own handling (new tab, etc).
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    router.push(action.value)
    return
  }

  // Dice, songs, sound effects and the screen are for signed-in users.
  if (!user.value) return
  e.preventDefault()
  if (action.kind === 'screen') e.stopPropagation()
  runInlineAction(action)
}

// The placeholders are role="button" spans: Enter and Space press them. Links
// and real buttons already turn those keys into a click.
function onKeydown(e) {
  if (e.key !== 'Enter' && e.key !== ' ') return
  const action = findInlineAction(e.target, root.value)
  if (!action || action.kind === 'note-link' || action.kind === 'screen' || !user.value) return
  e.preventDefault()
  runInlineAction(action)
}

function onMouseover(e) {
  const action = findInlineAction(e.target, root.value)
  if (action?.kind !== 'note-link') return
  const id = noteIdFromHref(action.value)
  if (id) emit('link-hover', id)
}
</script>

<style scoped>
.markdown-content {
  line-height: var(--leading-relaxed);
  color: var(--text-primary);
  font-size: var(--text-md);
}

/* Prose keeps a readable measure. Headings (and their rules), tables, code,
   callouts, and paragraphs that only wrap an image or a chart/vista embed
   still use the full column, and so does a sheet (it has its own layout). */
.markdown-content :deep(:is(p:not(:has(img, .doc-embed)), ul, ol, blockquote):not(.sheet-card *)) {
  max-width: 70ch;
}

.markdown-content :deep(h1),
.markdown-content :deep(h2),
.markdown-content :deep(h3),
.markdown-content :deep(h4),
.markdown-content :deep(h5),
.markdown-content :deep(h6) {
  margin-top: 1.8em;
  margin-bottom: 0.6em;
  color: var(--text-primary);
  font-weight: 600;
}

.markdown-content > :deep(:first-child) {
  margin-top: 0;
}

.markdown-content :deep(h1) {
  font-size: 1.875rem;
  padding-bottom: var(--space-2);
  border-bottom: 1px solid var(--border-medium);
}

.markdown-content :deep(h2) {
  font-size: 1.5rem;
  padding-bottom: var(--space-1);
  border-bottom: 1px solid var(--border-light);
}

.markdown-content :deep(h3) {
  font-size: 1.25rem;
}

.markdown-content :deep(h4) {
  font-size: 1.0625rem;
}

.markdown-content :deep(h5),
.markdown-content :deep(h6) {
  font-size: var(--text-md);
  color: var(--text-secondary);
}

.markdown-content :deep(p) {
  margin-bottom: 1em;
}

.markdown-content :deep(code) {
  background: var(--accent-a12);
  color: var(--accent-soft);
  padding: 0.15em 0.4em;
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: 0.875em;
}

.markdown-content :deep(pre) {
  background: var(--surface-sunken);
  padding: var(--space-4);
  border-radius: var(--radius-md);
  overflow-x: auto;
  margin-bottom: 1em;
  border: 1px solid var(--border-light);
  line-height: 1.55;
}

.markdown-content :deep(pre code) {
  background: transparent;
  color: var(--text-primary);
  padding: 0;
}

.markdown-content :deep(code.dice-roll) {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  background: var(--accent-a20);
  border: 1px solid var(--accent-a45);
  color: var(--accent-soft);
  cursor: pointer;
  transition:
    background-color var(--duration-fast) var(--ease-out),
    border-color var(--duration-fast) var(--ease-out),
    transform var(--duration-fast) var(--ease-out);
}

.markdown-content :deep(code.dice-roll .mdi) {
  font-size: 0.95em;
}

.markdown-content :deep(code.dice-roll:hover) {
  background: var(--accent-a45);
  border-color: var(--accent);
}

.markdown-content :deep(code.dice-roll:active) {
  transform: translateY(1px);
}

.markdown-content :deep(.doc-embed) {
  display: block;
}

.markdown-content :deep(.doc-embed-placeholder) {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 0.85em;
}

/* Sound effects: amber, apart from the teal music links, with the effect's
   progress filling the button while it sounds. Pressing again cuts it. */
.markdown-content :deep(code.sfx-button) {
  --sfx-progress: 0;
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  background:
    linear-gradient(90deg, rgba(251, 191, 36, 0.32) calc(var(--sfx-progress) * 100%), transparent 0),
    rgba(251, 191, 36, 0.14);
  border: 1px solid rgba(251, 191, 36, 0.4);
  color: #fcd34d;
  cursor: pointer;
  transition:
    border-color var(--duration-fast) var(--ease-out),
    box-shadow var(--duration-fast) var(--ease-out),
    transform var(--duration-fast) var(--ease-out);
}

.markdown-content :deep(code.sfx-button .mdi) {
  font-size: 0.95em;
}

.markdown-content :deep(code.sfx-button:hover) {
  border-color: rgba(251, 191, 36, 0.75);
}

.markdown-content :deep(code.sfx-button:active) {
  transform: translateY(1px);
}

.markdown-content :deep(code.sfx-button.is-playing) {
  border-color: rgba(251, 191, 36, 0.9);
  box-shadow: 0 0 0 2px rgba(251, 191, 36, 0.18);
}

.markdown-content :deep(code.sfx-button.sfx-button-error) {
  background: var(--status-error-bg);
  border-color: var(--status-error-border);
  color: var(--status-error);
}

/* Song links keep their own teal so they read apart from dice rolls. */
.markdown-content :deep(code.song-link) {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  background: rgba(45, 212, 191, 0.18);
  border: 1px solid rgba(45, 212, 191, 0.4);
  color: #5eead4;
  cursor: pointer;
  transition:
    background-color var(--duration-fast) var(--ease-out),
    border-color var(--duration-fast) var(--ease-out),
    transform var(--duration-fast) var(--ease-out);
}

.markdown-content :deep(code.song-link .mdi) {
  font-size: 0.95em;
}

.markdown-content :deep(code.song-link:hover) {
  background: rgba(45, 212, 191, 0.35);
  border-color: rgba(45, 212, 191, 0.7);
}

.markdown-content :deep(code.song-link:active) {
  transform: translateY(1px);
}

.markdown-content :deep(code.song-link.loading) {
  opacity: 0.6;
  cursor: wait;
}

.markdown-content :deep(code.song-link.song-link-error) {
  background: var(--status-error-bg);
  border-color: var(--status-error-border);
  color: var(--status-error);
}

.markdown-content :deep(a) {
  color: var(--accent-hover);
  text-decoration: underline;
  text-decoration-color: var(--accent-a45);
  text-underline-offset: 0.2em;
  border-radius: var(--radius-sm);
  transition:
    color var(--duration-fast) var(--ease-out),
    background-color var(--duration-fast) var(--ease-out),
    text-decoration-color var(--duration-fast) var(--ease-out);
}

.markdown-content :deep(a:hover) {
  color: var(--accent-soft);
  text-decoration-color: currentColor;
  background: var(--hover-tint);
}

/* Internal note links: no underline until hovered, so prose stays calm. */
.markdown-content :deep(a[data-note-link]) {
  text-decoration-color: transparent;
}

.markdown-content :deep(a[data-note-link]:hover) {
  text-decoration-color: currentColor;
}

.markdown-content :deep(blockquote) {
  border-left: 3px solid var(--accent-a45);
  margin: 1em 0;
  padding: var(--space-1) 0 var(--space-1) var(--space-4);
  color: var(--text-secondary);
  font-style: italic;
}

.markdown-content :deep(ul),
.markdown-content :deep(ol) {
  margin-bottom: 1em;
  padding-left: 1.75em;
}

.markdown-content :deep(li) {
  margin-bottom: 0.35em;
}

.markdown-content :deep(li::marker) {
  color: var(--text-muted);
}

.markdown-content :deep(hr) {
  border: none;
  border-top: 1px solid var(--border-light);
  margin: 2em 0;
}

/* Embedded charts/vistas style their own images (pin icons, vista assets).
   max-height keeps a tall 9:16 portrait from towering over a 16:9 one at
   the same column width — both cap out around the same on-screen size. */
.markdown-content :deep(img:not(.document-embed img)) {
  max-width: 100%;
  max-height: 60dvh;
  height: auto;
  border-radius: var(--radius-md);
  margin: 0;
  display: block;
}

/* Screen button wrapper. width: fit-content (not the full column) so a
   capped, narrower portrait image centers instead of sitting flush left,
   and so the send-to-screen button below stays anchored to the image
   itself rather than floating over empty space beside it. */
.markdown-content :deep(.img-screen-wrapper) {
  display: block;
  position: relative;
  width: fit-content;
  max-width: 100%;
  margin: var(--space-6) auto;
  line-height: 0;
  border-radius: var(--radius-md);
  overflow: visible;
}

.markdown-content :deep(.img-screen-btn) {
  position: absolute;
  top: var(--space-2);
  right: var(--space-2);
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  min-height: var(--control-sm);
  background: var(--surface-chrome);
  border: 1px solid var(--accent-a45);
  color: var(--accent-soft);
  padding: 0 var(--space-3);
  border-radius: var(--radius-md);
  font-size: var(--text-xs);
  font-weight: 500;
  line-height: 1;
  font-family: inherit;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  opacity: 0;
  transform: translateY(-4px);
  transition:
    opacity var(--duration-base) var(--ease-out),
    transform var(--duration-base) var(--ease-out),
    background-color var(--duration-fast) var(--ease-out),
    border-color var(--duration-fast) var(--ease-out),
    color var(--duration-fast) var(--ease-out);
  z-index: var(--z-raised);
  pointer-events: none;
  white-space: nowrap;
}

.markdown-content :deep(.img-screen-wrapper:hover .img-screen-btn),
.markdown-content :deep(.img-screen-btn:focus-visible) {
  opacity: 1;
  transform: translateY(0);
  pointer-events: auto;
}

/* No hover on touch screens: keep the button visible there. */
@media (hover: none) {
  .markdown-content :deep(.img-screen-btn) {
    opacity: 1;
    transform: none;
    pointer-events: auto;
  }
}

.markdown-content :deep(.img-screen-btn:hover) {
  background: var(--accent-strong);
  border-color: var(--accent-strong);
  color: var(--accent-contrast);
}

.markdown-content :deep(.img-screen-btn:active) {
  transform: translateY(1px);
}

.markdown-content :deep(.img-screen-btn.sent) {
  background: var(--status-success-bg);
  border-color: color-mix(in srgb, var(--status-success) 50%, transparent);
  color: var(--status-success);
}

.markdown-content :deep(.locked-asset) {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-4);
  color: var(--text-secondary);
  font-size: var(--text-sm);
}

.markdown-content :deep(pre.mermaid) {
  background: transparent;
  border: none;
  padding: var(--space-4) 0;
  overflow-x: auto;
}

.markdown-content :deep(pre.mermaid svg) {
  display: block;
  margin: 0 auto;
  max-width: 100%;
}

/* Every table sits in one of these (utils/renderNote.js): a table wider than
   the column, on a phone, scrolls sideways instead of widening the page. */
.markdown-content :deep(.table-scroll) {
  max-width: 100%;
  overflow-x: auto;
  margin-bottom: 1em;
  border-radius: var(--radius-md);
}

.markdown-content :deep(table) {
  border-collapse: collapse;
  width: 100%;
  margin-bottom: 1em;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  overflow: hidden;
  font-size: var(--text-base);
  line-height: var(--leading-normal);
}

.markdown-content :deep(.table-scroll > table) {
  margin-bottom: 0;
}

.markdown-content :deep(th),
.markdown-content :deep(td) {
  border: 1px solid var(--border-light);
  padding: var(--space-2) var(--space-3);
  text-align: left;
  vertical-align: top;
}

.markdown-content :deep(th) {
  background: var(--surface-raised);
  font-weight: 600;
  color: var(--text-primary);
}

.markdown-content :deep(tbody tr:hover) {
  background: var(--accent-a08);
}

/* Roll tables: the header die rolls, the row it lands on stays marked. */
.markdown-content :deep(.roll-table th:first-child),
.markdown-content :deep(.roll-table td:first-child) {
  width: 1%;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.markdown-content :deep(.roll-table td:first-child) {
  color: var(--text-secondary);
}

.markdown-content :deep(.roll-table-die) {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.1em 0.45em;
  border-radius: var(--radius-sm);
  background: var(--accent-a20);
  border: 1px solid var(--accent-a45);
  color: var(--accent-soft);
  font-family: var(--font-mono);
  font-size: 0.9em;
  font-weight: 500;
  cursor: pointer;
  user-select: none;
  transition:
    background-color var(--duration-fast) var(--ease-out),
    border-color var(--duration-fast) var(--ease-out),
    transform var(--duration-fast) var(--ease-out);
}

.markdown-content :deep(.roll-table-die:hover) {
  background: var(--accent-a45);
  border-color: var(--accent);
}

.markdown-content :deep(.roll-table-die:active) {
  transform: translateY(1px);
}

.markdown-content :deep(.roll-table-die:focus-visible) {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.markdown-content :deep(.roll-table[data-rolling] .roll-table-die) {
  cursor: progress;
  opacity: 0.7;
}

.markdown-content :deep(.roll-table-last) {
  margin-left: 0.1rem;
  padding: 0 0.4em;
  border-radius: 4px;
  background: var(--accent);
  color: var(--accent-contrast);
  font-weight: 700;
}

.markdown-content :deep(.roll-table tr.roll-scan) {
  background: var(--accent-a12);
}

.markdown-content :deep(.roll-table tr.roll-hit) {
  background: var(--accent-a20);
  animation: roll-land 700ms var(--ease-out);
}

.markdown-content :deep(.roll-table tr.roll-hit td:first-child) {
  box-shadow: inset 3px 0 0 var(--accent);
  color: var(--accent-soft);
  font-weight: 700;
}

@keyframes roll-land {
  from { background: var(--accent-a45); }
}

@media (prefers-reduced-motion: reduce) {
  .markdown-content :deep(.roll-table tr.roll-hit) {
    animation: none;
  }
}

/* Obsidian-style callouts. Type colours are content, kept literal. */
.markdown-content :deep(.callout) {
  --callout-color: #a78bfa;
  margin: 1em 0;
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-md);
  border-left: 3px solid var(--callout-color);
  background: color-mix(in srgb, var(--callout-color) 12%, transparent);
}

.markdown-content :deep(.callout-title) {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
  font-weight: 600;
  color: var(--callout-color);
}

.markdown-content :deep(.callout-title .mdi) {
  font-size: 1.1rem;
}

.markdown-content :deep(.callout-content) {
  margin-top: var(--space-2);
}

.markdown-content :deep(.callout-content) > :first-child {
  margin-top: 0;
}

.markdown-content :deep(.callout-content) > :last-child {
  margin-bottom: 0;
}

.markdown-content :deep(.callout-blue) { --callout-color: #58a6ff; }
.markdown-content :deep(.callout-cyan) { --callout-color: #22d3ee; }
.markdown-content :deep(.callout-teal) { --callout-color: #2dd4bf; }
.markdown-content :deep(.callout-green) { --callout-color: #3fb950; }
.markdown-content :deep(.callout-amber) { --callout-color: #d4a72c; }
.markdown-content :deep(.callout-orange) { --callout-color: #f0883e; }
.markdown-content :deep(.callout-red) { --callout-color: #f85149; }
.markdown-content :deep(.callout-purple) { --callout-color: #a78bfa; }
.markdown-content :deep(.callout-grey) { --callout-color: #8b949e; }
</style>
