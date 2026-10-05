import { defineAsyncComponent, h, render } from 'vue'
import DocumentEmbed from '@/components/DocumentEmbed.vue'
import { DOC_TYPES } from '@/utils/docTypes'

// A sheet (and the YAML parser it needs) is only fetched for a note that shows one.
const SheetEmbed = defineAsyncComponent(() => import('@/components/SheetEmbed.vue'))

/**
 * The `[data-doc-embed]` placeholders of rendered markdown that should get a
 * component: every one except those inside another embed (a sheet's own text
 * is markdown too, and a raw placeholder written there must not mount a
 * sheet inside itself).
 */
export function findEmbedHosts(root) {
  return [...root.querySelectorAll('[data-doc-embed]')].filter((el) => !el.parentElement?.closest('.doc-embed'))
}

/**
 * Mounts a real component on each document placeholder the inline-code rule
 * left in rendered markdown: a chart or vista a DocumentEmbed, a character or
 * adversary a SheetEmbed. v-html knows nothing about those component trees,
 * so whoever replaces the HTML calls unmountAll() first (and on unmount),
 * which also ends their live subscriptions.
 *
 * `appContext` shares the app's router and plugins with these detached trees.
 */
export function createDocEmbeds(appContext) {
  let hosts = []

  function mountAll(root, { canInteract, pageHeadings = [] }) {
    for (const el of findEmbedHosts(root)) {
      const type = el.getAttribute('data-doc-embed')
      const props = { type, id: el.getAttribute('data-doc-id'), canInteract }
      const vnode = DOC_TYPES[type]?.sheet ? h(SheetEmbed, { ...props, pageHeadings }) : h(DocumentEmbed, props)
      vnode.appContext = appContext
      el.textContent = ''
      render(vnode, el)
      hosts.push(el)
    }
  }

  function unmountAll() {
    hosts.forEach((el) => render(null, el))
    hosts = []
  }

  return { mountAll, unmountAll }
}
