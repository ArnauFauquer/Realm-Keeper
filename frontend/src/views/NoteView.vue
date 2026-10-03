<template>
  <div class="note-view-container">
    <div class="note-main-content">
      <div v-if="loading" class="note-content note-loading" aria-busy="true">
        <span class="rk-visually-hidden">Loading note...</span>
        <div class="rk-skeleton skeleton-title"></div>
        <div class="rk-skeleton skeleton-meta"></div>
        <div class="skeleton-body">
          <div class="rk-skeleton skeleton-line"></div>
          <div class="rk-skeleton skeleton-line"></div>
          <div class="rk-skeleton skeleton-line short"></div>
        </div>
      </div>

      <div v-else-if="isEditing" class="note-content editor-shell">
        <header class="editor-header">
          <h1>{{ isCreating ? 'New note' : note.title }}</h1>
          <p class="editor-path">{{ notePath }}</p>
        </header>

        <div class="editor-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            class="editor-tab"
            :class="{ active: editorTab === 'write' }"
            :aria-selected="editorTab === 'write'"
            @click="editorTab = 'write'"
          >Write</button>
          <button
            type="button"
            role="tab"
            class="editor-tab"
            :class="{ active: editorTab === 'preview' }"
            :aria-selected="editorTab === 'preview'"
            @click="editorTab = 'preview'"
          >Preview</button>
        </div>

        <div v-if="editorTab === 'write'" class="editor-toolbar">
          <span class="editor-toolbar-label">Insert</span>
          <button type="button" class="rk-btn rk-btn--sm" @click="insertSheetTemplate('adversary')">
            <span class="mdi mdi-skull-outline"></span> Adversary sheet
          </button>
          <button type="button" class="rk-btn rk-btn--sm" @click="insertSheetTemplate('character')">
            <span class="mdi mdi-account-outline"></span> Character sheet
          </button>
        </div>

        <textarea
          v-if="editorTab === 'write'"
          ref="editorTextarea"
          v-model="draftContent"
          class="editor-textarea"
          placeholder="# Title

Write your note in Markdown..."
          spellcheck="false"
        ></textarea>
        <article
          v-else
          ref="previewContent"
          class="markdown-content editor-preview"
          v-html="draftPreviewHtml"
        ></article>

        <div v-if="saveError" class="rk-alert" role="alert">
          <span class="mdi mdi-alert-circle-outline"></span>
          <span>{{ saveError }}</span>
        </div>

        <div class="editor-actions">
          <button type="button" class="rk-btn rk-btn--ghost" :disabled="saving" @click="cancelEditing">Cancel</button>
          <button type="button" class="rk-btn rk-btn--primary" :disabled="saving" @click="saveNote">
            <span v-if="saving" class="rk-spinner btn-spinner"></span>
            {{ saving ? 'Saving…' : 'Save' }}
          </button>
        </div>
      </div>

      <div v-else-if="noteNotFound" class="note-content not-found">
        <span class="mdi mdi-file-question-outline"></span>
        <h2>This note doesn't exist yet</h2>
        <p class="not-found-path">{{ notePath }}</p>
        <button v-if="user" type="button" class="rk-btn rk-btn--primary" @click="startCreating">Create this note</button>
        <p v-else class="not-found-path">Sign in to create it.</p>
      </div>

      <div v-else-if="error" class="note-content note-error">
        <div class="rk-alert" role="alert">
          <span class="mdi mdi-alert-circle-outline"></span>
          <div>
            <strong>Could not load this note.</strong>
            <p>{{ error }}</p>
          </div>
        </div>
      </div>

      <div v-else-if="note" class="note-content">
        <header class="note-header">
          <div class="note-header-top">
            <h1>{{ note.title }}</h1>
            <button
              v-if="user"
              type="button"
              class="rk-icon-btn edit-note-btn"
              title="Edit this note"
              aria-label="Edit this note"
              @click="startEditing"
            >
              <span class="mdi mdi-pencil-outline"></span>
            </button>
          </div>
          <div class="note-meta">
            <nav class="note-breadcrumb" aria-label="Breadcrumb">
              <template v-for="(crumb, index) in breadcrumbs" :key="index">
                <router-link
                  v-if="crumb.to"
                  :to="crumb.to"
                  class="breadcrumb-link"
                >
                  {{ crumb.name }}
                </router-link>
                <span v-else class="breadcrumb-current">{{ crumb.name }}</span>
                <span v-if="index < breadcrumbs.length - 1" class="breadcrumb-separator">/</span>
              </template>
            </nav>
            <div v-if="note.tags && note.tags.length" class="tags">
              <button
                v-for="tag in note.tags"
                :key="tag"
                type="button"
                class="tag clickable"
                @click="filterByTag(tag)"
                title="Filter by this tag"
              >
                #{{ tag }}
              </button>
            </div>
          </div>
        </header>

        <article class="markdown-content" ref="markdownContent" v-html="renderedContent"></article>
      </div>
    </div>

    <RightSidebar v-if="note && !loading && !error && !isEditing" :note="note" />
  </div>
</template>

<script>
import mermaid from 'mermaid'
import { getCached, post, put, invalidateCached } from '@/api/http'
import { apiUrl } from '@/config/env'
import { slugifyHeading } from '@/utils/slugify'
import { lockAssetImages, sanitizeHtml } from '@/utils/sanitizeHtml'
import { renderCallouts } from '@/utils/callouts'
import { defineAsyncComponent, h, render } from 'vue'
import { createMarkdown } from '@/utils/markdown'
import { SHEET_TEMPLATES } from '@/utils/sheet'
import { useDiceRoller } from '@/composables/useDiceRoller'
import { usePlayer } from '@/composables/usePlayer'
import { useAuth } from '@/composables/useAuth'
import RightSidebar from '@/components/RightSidebar.vue'
import DocumentEmbed from '@/components/DocumentEmbed.vue'

// A sheet (and the YAML parser it needs) is only fetched for a note that has one.
const SheetBlock = defineAsyncComponent(() => import('@/components/SheetBlock.vue'))

mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  themeVariables: {
    darkMode: true,
    background: '#12132a',
    primaryColor: '#1a1b3a',
    primaryTextColor: '#f0f0ff',
    primaryBorderColor: '#8a5cf5',
    lineColor: '#a78bfa',
    secondaryColor: '#1a1b3a',
    tertiaryColor: '#12132a',
    // Gantt task labels that don't fit inside their bar are drawn outside it,
    // against the diagram background rather than the bar. Mermaid accounts
    // for that on :done tasks (it swaps in taskTextOutsideColor) but not on
    // :active ones, which keep taskTextDarkColor — meant for dark text on the
    // light active-task bar — even when placed outside on our dark bg, making
    // them invisible. Keeping this light fixes that; it only trades away
    // contrast for the (currently unused) case of a label short enough to
    // fit inside the light active bar itself.
    taskTextDarkColor: '#f0f0ff',
    taskTextColor: '#f0f0ff',
    taskTextLightColor: '#f0f0ff',
    taskTextOutsideColor: '#f0f0ff'
  }
})

export default {
  name: 'NoteView',
  components: { RightSidebar },
  inject: {
    addTagFilter: {
      from: 'addTagFilter',
      default: () => () => {}
    }
  },
  props: {
    notePath: {
      type: String,
      required: true
    }
  },
  setup() {
    const { user } = useAuth()
    return { user }
  },
  data() {
    const md = createMarkdown()

    const defaultFence = md.renderer.rules.fence || function (tokens, idx, options, env, self) {
      return self.renderToken(tokens, idx, options)
    }
    md.renderer.rules.fence = (tokens, idx, options, env, self) => {
      const token = tokens[idx]
      const lang = token.info.trim().toLowerCase()
      if (lang === 'mermaid') {
        return `<pre class="mermaid">${md.utils.escapeHtml(token.content)}</pre>`
      }
      // A sheet is drawn by a component mounted into this placeholder (see
      // mountDocEmbeds). The YAML travels in an attribute, on one line and
      // without headings: callouts render their body twice, and a raw HTML
      // block ends at the first blank line, which the YAML may well contain.
      if (lang === 'sheet') {
        const src = md.utils.escapeHtml(encodeURIComponent(token.content))
        return `<div class="sheet-block" data-sheet-src="${src}"></div>\n`
      }
      return defaultFence(tokens, idx, options, env, self)
    }

    return {
      note: null,
      loading: true,
      error: null,
      noteNotFound: false,
      md,
      prefetchCache: new Set(),
      prefetchTimeout: null,
      containerFolders: {},
      // Elements that currently host a mounted DocumentEmbed (chart/vista).
      mountedEmbeds: [],
      isEditing: false,
      isCreating: false,
      editorTab: 'write',
      draftContent: '',
      saving: false,
      saveError: null
    }
  },
  computed: {
    draftPreviewHtml() {
      if (!this.draftContent.trim()) return '<p class="preview-empty">Nothing to preview yet.</p>'
      return sanitizeHtml(this.md.render(this.draftContent))
    },
    breadcrumbs() {
      if (!this.note || !this.note.id || !this.containerFolders) return []
      
      const parts = this.note.id.split('/')
      // Start with a link to the root notes view
      const crumbs = [{ name: 'Notes', to: '/' }]
      
      let currentPath = ''
      for (let i = 0; i < parts.length; i++) {
        const name = parts[i]
        const isLast = i === parts.length - 1
        
        currentPath = currentPath ? `${currentPath}/${name}` : name
        
        if (isLast) {
          crumbs.push({ name, to: null })
        } else {
          // If the folder mapping has a note ID for this path, use it as the link
          const targetNoteId = this.containerFolders[currentPath]
          if (targetNoteId) {
            crumbs.push({ name, to: '/note/' + encodeURIComponent(targetNoteId) })
          } else {
            crumbs.push({ name, to: null })
          }
        }
      }
      
      return crumbs
    },
    renderedContent() {
      if (!this.note || !this.note.content) return ''
      const withCallouts = renderCallouts(this.note.content, (text) => this.md.render(text))
      let html = this.md.render(withCallouts)

      // Add IDs to headers for ToC navigation
      let headerCount = {}
      html = html.replace(/<h([1-6])>(.*?)<\/h\1>/g, (match, level, content) => {
        const id = slugifyHeading(content, headerCount)
        return `<h${level} id="${id}">${content}</h${level}>`
      })

      html = html.replace(/<a href="\/note\/([^"]+)"/g, (match, linkId) => {
        return `<a href="/note/${linkId}" data-note-link="${linkId}"`
      })
      html = sanitizeHtml(html)
      return this.user ? html : lockAssetImages(html)
    }
  },
  methods: {
    filterByTag(tag) {
      this.addTagFilter(tag)
    },
    async fetchNote() {
      this.loading = true
      this.error = null
      this.noteNotFound = false
      this.isEditing = false
      this.isCreating = false

      try {
        this.note = await getCached(`${apiUrl}/api/note/${this.notePath}`, { cacheTtl: 300 })
        this.loading = false

        this.setupLinkPrefetch()
        this.renderMermaidDiagrams()

        this.prefetchLinkedNotes(this.note.links || [])
      } catch (err) {
        this.loading = false
        if (err.response?.status === 404) {
          this.noteNotFound = true
          if (this.$route.query.new === '1' && this.user) {
            this.startCreating()
          }
        } else {
          this.error = err.response?.data?.detail || err.message
        }
      }
    },
    async startEditing() {
      this.saveError = null
      this.editorTab = 'write'
      try {
        const data = await getCached(`${apiUrl}/api/note-raw/${this.notePath}`, { useCache: false })
        this.draftContent = data.content
        this.isEditing = true
        this.isCreating = false
      } catch (err) {
        this.error = err.response?.data?.detail || err.message
      }
    },
    startCreating() {
      const title = this.notePath.split('/').pop()
      this.draftContent = `# ${title}\n\n`
      this.editorTab = 'write'
      this.saveError = null
      this.isCreating = true
      this.isEditing = true
    },
    // Drops a sheet template into the draft where the cursor is.
    insertSheetTemplate(type) {
      const textarea = this.$refs.editorTextarea
      const snippet = `\n${SHEET_TEMPLATES[type]}\n`
      const start = textarea ? textarea.selectionStart : this.draftContent.length
      const end = textarea ? textarea.selectionEnd : start
      this.draftContent = this.draftContent.slice(0, start) + snippet + this.draftContent.slice(end)
      this.$nextTick(() => {
        if (!textarea) return
        textarea.focus()
        textarea.setSelectionRange(start + snippet.length, start + snippet.length)
      })
    },
    cancelEditing() {
      this.isEditing = false
      this.isCreating = false
      this.saveError = null
    },
    async saveNote() {
      this.saving = true
      this.saveError = null
      try {
        await put(`${apiUrl}/api/note/${this.notePath}`, { content: this.draftContent })
        invalidateCached(`${apiUrl}/api/note/${this.notePath}`)
        invalidateCached(`${apiUrl}/api/note-raw/${this.notePath}`)
        invalidateCached(`${apiUrl}/api/notes`)
        this.isEditing = false
        this.isCreating = false
        await this.fetchNote()
      } catch (err) {
        this.saveError = err.response?.data?.detail || err.message || 'Could not save the note.'
      } finally {
        this.saving = false
      }
    },
    prefetchLinkedNotes(links) {
      if (!links || links.length === 0) return

      const prefetchFn = () => {
        links.slice(0, 5).forEach(linkId => {
          if (this.prefetchCache.has(linkId)) return
          
          this.prefetchCache.add(linkId)

          getCached(`${apiUrl}/api/note/${linkId}`, { cacheTtl: 300, timeout: 2000 }).catch(() => {
          })
        })
      }

      if (this.prefetchTimeout) {
        clearTimeout(this.prefetchTimeout)
      }

      if ('requestIdleCallback' in window) {
        requestIdleCallback(prefetchFn)
      } else {
        this.prefetchTimeout = setTimeout(prefetchFn, 1000)
      }
    },
    onLinkMouseEnter(linkId) {
      if (this.prefetchCache.has(linkId)) return
      
      this.prefetchCache.add(linkId)

      getCached(`${apiUrl}/api/note/${linkId}`, { cacheTtl: 300, timeout: 1500 }).catch(() => {
      })
    },
    setupLinkPrefetch() {
      this.$nextTick(() => {
        const content = this.$refs.markdownContent
        if (!content) return
        
        // :not(wired) — this also runs again whenever renderedContent
        // re-renders (see the watcher), and must not stack listeners.
        const links = content.querySelectorAll('a[data-note-link]:not([data-link-wired])')
        links.forEach(link => {
          const linkId = link.getAttribute('data-note-link')
          if (!linkId) return
          link.setAttribute('data-link-wired', '1')

          link.addEventListener('mouseenter', () => {
            this.onLinkMouseEnter(linkId)
          }, { once: false })

          // Plain <a> from v-html isn't a <router-link>, so a click would
          // otherwise trigger a full page navigation (reloading the app and
          // killing audio playback). Route it through Vue Router instead,
          // unless the user wants the browser's own handling (new tab, etc).
          link.addEventListener('click', (e) => {
            if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
            e.preventDefault()
            this.$router.push(`/note/${linkId}`)
          })
        })

        this.mountDocEmbeds(content)

        if (this.user) {
          this.setupImageScreenButtons()
          this.setupDiceRolls()
          this.setupSongLinks()
        }
      })
    },
    // Makes every not-yet-wired element carrying `attr` behave like a
    // button (click / Enter / Space), calling handler(el, attrValue).
    wireInlineActions(attr, handler) {
      const content = this.$refs.markdownContent
      if (!content) return

      content.querySelectorAll(`[${attr}]:not([data-inline-wired])`).forEach(el => {
        el.setAttribute('data-inline-wired', '1')
        const value = el.getAttribute(attr)
        const trigger = (e) => {
          e.preventDefault()
          handler(el, value)
        }
        el.addEventListener('click', trigger)
        el.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') trigger(e)
        })
      })
    },
    setupDiceRolls() {
      const { roll } = useDiceRoller()
      this.wireInlineActions('data-dice-formula', (el, formula) => roll(formula))
    },
    setupSongLinks() {
      const { playByKey } = usePlayer()
      this.wireInlineActions('data-song-key', async (el, key) => {
        if (el.classList.contains('loading')) return
        el.classList.add('loading')
        try {
          await playByKey(key)
        } catch (err) {
          console.error('Failed to play track:', err)
          el.classList.add('song-link-error')
          setTimeout(() => el.classList.remove('song-link-error'), 2000)
        } finally {
          el.classList.remove('loading')
        }
      })
    },
    // Chart/vista placeholders from the inline-code rule get a real
    // DocumentEmbed rendered into them, and ```sheet placeholders a
    // SheetBlock. v-html knows nothing about those component trees, so hosts
    // whose DOM a later render replaced are unmounted here (and every
    // remaining one in beforeUnmount).
    mountDocEmbeds(root) {
      this.mountedEmbeds = this.mountedEmbeds.filter(el => {
        if (el.isConnected) return true
        render(null, el)
        return false
      })

      if (!root) return

      root.querySelectorAll('[data-doc-embed]:not([data-embed-mounted])').forEach(el => {
        el.setAttribute('data-embed-mounted', '1')
        const vnode = h(DocumentEmbed, {
          type: el.getAttribute('data-doc-embed'),
          id: el.getAttribute('data-doc-id'),
          canInteract: !!this.user
        })
        // Share the app's router/plugins with this detached render tree.
        vnode.appContext = this.$.appContext
        el.textContent = ''
        render(vnode, el)
        this.mountedEmbeds.push(el)
      })

      root.querySelectorAll('[data-sheet-src]:not([data-embed-mounted])').forEach(el => {
        el.setAttribute('data-embed-mounted', '1')
        let source
        try {
          source = decodeURIComponent(el.getAttribute('data-sheet-src'))
        } catch {
          // Hand-written HTML with a broken attribute: leave it, and still
          // mount the embeds after it.
          return
        }
        const vnode = h(SheetBlock, {
          source,
          // An adversary's reference is "<note id>#<sheet id>".
          noteId: this.note?.id || this.notePath,
          canInteract: !!this.user
        })
        vnode.appContext = this.$.appContext
        el.textContent = ''
        render(vnode, el)
        this.mountedEmbeds.push(el)
      })
    },
    unmountDocEmbeds() {
      this.mountedEmbeds.forEach(el => render(null, el))
      this.mountedEmbeds = []
    },
    renderMermaidDiagrams() {
      this.$nextTick(() => {
        const content = this.$refs.markdownContent
        if (!content) return

        const diagrams = content.querySelectorAll('pre.mermaid')
        if (!diagrams.length) return

        // Mermaid sizes diagrams (e.g. gantt) from the container's current
        // offsetWidth. Right after the DOM patch the layout may not have
        // settled yet (sibling panels still loading their own content), so
        // wait until the container actually has width before rendering.
        this.waitForLayoutWidth(content, () => {
          mermaid.run({ nodes: diagrams }).catch(err => {
            console.error('Failed to render Mermaid diagram:', err)
          })
        })
      })
    },
    waitForLayoutWidth(el, callback, attempts = 0) {
      if (el.offsetWidth > 0 || attempts >= 10) {
        requestAnimationFrame(callback)
        return
      }
      requestAnimationFrame(() => this.waitForLayoutWidth(el, callback, attempts + 1))
    },
    setupImageScreenButtons() {
      const content = this.$refs.markdownContent
      if (!content) return

      const images = content.querySelectorAll('img:not([data-screen-wrapped])')
      images.forEach(img => {
        // Chart/vista embeds have their own screen button for the whole scene.
        if (img.closest('.doc-embed')) return
        img.setAttribute('data-screen-wrapped', '1')

        // Wrap in a relative container
        const wrapper = document.createElement('span')
        wrapper.className = 'img-screen-wrapper'
        img.parentNode.insertBefore(wrapper, img)
        wrapper.appendChild(img)

        // Build button
        const btn = document.createElement('button')
        btn.className = 'img-screen-btn'
        btn.title = 'Display on screen'
        btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg><span>Screen</span>`
        btn.addEventListener('click', async (e) => {
          e.preventDefault()
          e.stopPropagation()
          const url = img.src
          const title = img.alt || ''
          
          try {
            await post(`${apiUrl}/api/screen/display`, { url, title })
            const originalText = btn.innerHTML
            btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg><span>Sent!</span>`
            btn.classList.add('sent')
            setTimeout(() => {
              btn.classList.remove('sent')
              btn.innerHTML = originalText
            }, 2000)
          } catch (err) {
            console.error('Failed to send to screen:', err)
          }
        })
        wrapper.appendChild(btn)
      })
    },
    async loadContainerFolders() {
      try {
        this.containerFolders = await getCached(`${apiUrl}/api/container-folders`, { cacheTtl: 300 })
      } catch (err) {
        console.error('Error loading container folders:', err)
      }
    }
  },
  mounted() {
    this.loadContainerFolders()
  },
  watch: {
    // renderedContent also depends on whether someone is signed in (library
    // images become placeholders without it), so it re-renders when the
    // session check resolves or on logout — not only after fetchNote(), which
    // is where the v-html's links, embeds, buttons and diagrams get wired.
    renderedContent() {
      this.setupLinkPrefetch()
      this.renderMermaidDiagrams()
    },
    // The editor preview is its own v-html, re-rendered on every keystroke
    // or tab switch; keep its chart/vista embeds mounted too.
    draftPreviewHtml() {
      this.$nextTick(() => this.mountDocEmbeds(this.$refs.previewContent))
    },
    editorTab() {
      this.$nextTick(() => this.mountDocEmbeds(this.$refs.previewContent))
    },
    notePath: {
      immediate: true,
      handler() {
        this.fetchNote()
      }
    }
  },
  beforeUnmount() {
    this.unmountDocEmbeds()
    if (this.prefetchTimeout) {
      clearTimeout(this.prefetchTimeout)
    }
  }
}
</script>

<style scoped>
.note-view-container {
  display: flex;
  flex: 1;
  max-width: 1400px;
  margin: 0 auto;
  padding: var(--space-8);
  gap: var(--space-8);
  align-items: flex-start;
}

.note-main-content {
  flex: 1;
  min-width: 0;
}

.note-content {
  background: var(--surface-app);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg);
  padding: var(--space-8);
  box-shadow: var(--shadow-md);
}

/* ── Loading / error ─────────────────────────────────────────── */
.note-loading {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.skeleton-title {
  width: 45%;
  height: 2.25rem;
}

.skeleton-meta {
  width: 30%;
  height: 1rem;
  margin-bottom: var(--space-4);
}

.skeleton-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.skeleton-line {
  height: 0.9rem;
}

.skeleton-line.short {
  width: 60%;
}

.note-error .rk-alert strong {
  display: block;
  margin-bottom: var(--space-1);
}

/* ── Header ──────────────────────────────────────────────────── */
.note-header {
  margin-bottom: var(--space-8);
  padding-bottom: var(--space-4);
  border-bottom: 1px solid var(--border-light);
}

.note-header h1 {
  margin: 0;
  font-size: var(--text-2xl);
  color: var(--text-primary);
}

.note-header-top {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
}

.edit-note-btn {
  color: var(--text-muted);
}

.edit-note-btn:hover:not(:disabled) {
  color: var(--accent-hover);
}

.edit-note-btn .mdi {
  font-size: 1.1rem;
}

/* ── Editor ─────────────────────────────────────────────────── */
.editor-shell {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.editor-header {
  border-bottom: 1px solid var(--border-light);
  padding-bottom: var(--space-4);
}

.editor-header h1 {
  margin: 0 0 var(--space-1) 0;
  font-size: var(--text-2xl);
  color: var(--text-primary);
}

.editor-path {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-sm);
  font-family: var(--font-mono);
}

.editor-tabs {
  display: flex;
  gap: var(--space-1);
  border-bottom: 1px solid var(--border-light);
}

.editor-tab {
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  border-radius: var(--radius-sm) var(--radius-sm) 0 0;
  color: var(--text-secondary);
  padding: var(--space-2) var(--space-4);
  margin-bottom: -1px;
  font-size: var(--text-sm);
  font-weight: 500;
  transition:
    color var(--duration-fast) var(--ease-out),
    border-color var(--duration-fast) var(--ease-out),
    background-color var(--duration-fast) var(--ease-out);
}

.editor-tab:hover {
  color: var(--text-primary);
  background: var(--hover-tint);
}

.editor-tab:active {
  background: var(--accent-a12);
}

.editor-tab.active {
  color: var(--text-primary);
  border-bottom-color: var(--accent);
}

.editor-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.editor-toolbar-label {
  font-size: var(--text-sm);
  color: var(--text-muted);
}

.editor-textarea {
  width: 100%;
  min-height: 50dvh;
  resize: vertical;
  background: var(--surface-sunken);
  border: 1px solid var(--border-medium);
  border-radius: var(--radius-md);
  padding: var(--space-4);
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: var(--text-base);
  line-height: 1.6;
  transition: border-color var(--duration-fast) var(--ease-out), box-shadow var(--duration-fast) var(--ease-out);
}

.editor-textarea::placeholder {
  color: var(--text-muted);
}

.editor-textarea:focus,
.editor-textarea:focus-visible {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-a20);
  border-radius: var(--radius-md);
}

.editor-preview {
  min-height: 50dvh;
  padding: var(--space-4);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
}

.editor-preview :deep(.preview-empty) {
  color: var(--text-muted);
  font-style: italic;
}

.editor-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-3);
}

/* Spinner sits on the solid accent button, so it is drawn in the
   contrast colour instead of the default accent ring. */
.btn-spinner {
  width: 14px;
  height: 14px;
  border-color: color-mix(in srgb, var(--accent-contrast) 30%, transparent);
  border-top-color: var(--accent-contrast);
}

/* ── Not found ───────────────────────────────────────────────── */
.not-found {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: var(--space-3);
  max-width: 420px;
  margin: var(--space-12) auto;
  padding: var(--space-10) var(--space-8);
}

.not-found .mdi {
  font-size: 3rem;
  color: var(--text-muted);
}

.not-found h2 {
  margin: 0;
  font-size: var(--text-xl);
  color: var(--text-primary);
}

.not-found-path {
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  color: var(--text-muted);
  margin: 0 0 var(--space-2) 0;
  word-break: break-all;
}

/* ── Meta: breadcrumb + tags ─────────────────────────────────── */
.note-meta {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.note-breadcrumb {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--text-sm);
  color: var(--text-secondary);
}

.breadcrumb-link {
  color: var(--text-secondary);
  text-decoration: none;
  border-radius: var(--radius-sm);
  transition: color var(--duration-fast) var(--ease-out);
}

.breadcrumb-link:hover {
  color: var(--accent-hover);
}

.breadcrumb-separator {
  color: var(--text-muted);
  margin: 0 2px;
}

.breadcrumb-current {
  color: var(--text-primary);
  font-weight: 500;
}

.tags {
  display: flex;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.tag {
  background: var(--accent-a12);
  color: var(--accent-hover);
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-full);
  font-size: var(--text-xs);
  font-weight: 500;
  line-height: 1.4;
  border: 1px solid var(--accent-a30);
}

.tag.clickable {
  transition:
    background-color var(--duration-fast) var(--ease-out),
    border-color var(--duration-fast) var(--ease-out),
    color var(--duration-fast) var(--ease-out),
    transform var(--duration-fast) var(--ease-out);
}

.tag.clickable:hover {
  background: var(--accent-a30);
  border-color: var(--accent);
  color: var(--accent-soft);
}

.tag.clickable:active {
  transform: translateY(1px);
}

.tag.clickable:focus-visible {
  border-radius: var(--radius-full);
}

/* ── Rendered markdown ───────────────────────────────────────── */
.markdown-content {
  line-height: var(--leading-relaxed);
  color: var(--text-primary);
  font-size: var(--text-md);
}

/* Prose keeps a readable measure. Headings (and their rules), tables, code,
   callouts, and paragraphs that only wrap an image or a chart/vista embed
   still use the full column. */
.markdown-content :deep(:is(p:not(:has(img, .doc-embed)), ul, ol, blockquote)) {
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

.markdown-content :deep(.doc-embed),
.markdown-content :deep(.sheet-block) {
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

/* ── Small screens ───────────────────────────────────────────── */
/* Laptop widths: both sidebars are visible, so give the text the room. */
@media (max-width: 1439px) {
  .note-view-container {
    padding: var(--space-6);
    gap: var(--space-6);
  }

  .note-content {
    padding: var(--space-6);
  }
}

@media (max-width: 768px) {
  .note-view-container {
    padding: var(--space-4);
  }

  .note-content {
    padding: var(--space-5);
  }

  .note-header h1,
  .editor-header h1 {
    font-size: var(--text-xl);
  }
}
</style>
