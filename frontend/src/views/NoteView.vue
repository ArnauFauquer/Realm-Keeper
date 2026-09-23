<template>
  <div class="note-view-container">
    <div class="note-main-content">
      <div v-if="loading" class="loading">
        <p>Loading note...</p>
      </div>

      <div v-else-if="isEditing" class="note-content editor-shell">
        <header class="editor-header">
          <h1>{{ isCreating ? 'New note' : note.title }}</h1>
          <p class="editor-path">{{ notePath }}</p>
        </header>

        <div class="editor-tabs">
          <button
            class="editor-tab"
            :class="{ active: editorTab === 'write' }"
            @click="editorTab = 'write'"
          >Write</button>
          <button
            class="editor-tab"
            :class="{ active: editorTab === 'preview' }"
            @click="editorTab = 'preview'"
          >Preview</button>
        </div>

        <textarea
          v-if="editorTab === 'write'"
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

        <p v-if="saveError" class="editor-error">{{ saveError }}</p>

        <div class="editor-actions">
          <button class="editor-btn cancel" :disabled="saving" @click="cancelEditing">Cancel</button>
          <button class="editor-btn save" :disabled="saving" @click="saveNote">
            <span v-if="saving" class="btn-spinner"></span>
            {{ saving ? 'Saving…' : 'Save' }}
          </button>
        </div>
      </div>

      <div v-else-if="noteNotFound" class="note-content not-found">
        <span class="mdi mdi-file-question-outline"></span>
        <h2>This note doesn't exist yet</h2>
        <p class="not-found-path">{{ notePath }}</p>
        <button v-if="user" class="editor-btn save" @click="startCreating">Create this note</button>
        <p v-else class="not-found-path">Sign in to create it.</p>
      </div>

      <div v-else-if="error" class="error">
        <h2>Error</h2>
        <p>{{ error }}</p>
      </div>

      <div v-else-if="note" class="note-content">
        <header class="note-header">
          <div class="note-header-top">
            <h1>{{ note.title }}</h1>
            <button v-if="user" class="edit-note-btn" title="Edit this note" @click="startEditing">
              <span class="mdi mdi-pencil-outline"></span>
            </button>
          </div>
          <div class="note-meta">
            <nav class="note-breadcrumb">
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
              <span
                v-for="tag in note.tags"
                :key="tag"
                class="tag clickable"
                @click="filterByTag(tag)"
                title="Filter by this tag"
              >
                #{{ tag }}
              </span>
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
import MarkdownIt from 'markdown-it'
import mermaid from 'mermaid'
import { getCached, post, put, invalidateCached } from '@/api/http'
import { apiUrl } from '@/config/env'
import { slugifyHeading } from '@/utils/slugify'
import { lockAssetImages, sanitizeHtml } from '@/utils/sanitizeHtml'
import { renderCallouts } from '@/utils/callouts'
import { h, render } from 'vue'
import { parseInlineRef, renderInlineRef } from '@/utils/inlineRefs'
import { useDiceRoller } from '@/composables/useDiceRoller'
import { usePlayer } from '@/composables/usePlayer'
import { useAuth } from '@/composables/useAuth'
import RightSidebar from '@/components/RightSidebar.vue'
import DocumentEmbed from '@/components/DocumentEmbed.vue'

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
    const md = new MarkdownIt({
      html: true,
      linkify: true,
      typographer: true,
      breaks: true
    })

    const defaultFence = md.renderer.rules.fence || function (tokens, idx, options, env, self) {
      return self.renderToken(tokens, idx, options)
    }
    md.renderer.rules.fence = (tokens, idx, options, env, self) => {
      const token = tokens[idx]
      const lang = token.info.trim().toLowerCase()
      if (lang === 'mermaid') {
        return `<pre class="mermaid">${md.utils.escapeHtml(token.content)}</pre>`
      }
      return defaultFence(tokens, idx, options, env, self)
    }

    const defaultCodeInline = md.renderer.rules.code_inline || function (tokens, idx, options, env, self) {
      return self.renderToken(tokens, idx, options)
    }
    md.renderer.rules.code_inline = (tokens, idx, options, env, self) => {
      const ref = parseInlineRef(tokens[idx].content)
      if (ref) return renderInlineRef(ref, md.utils.escapeHtml)
      return defaultCodeInline(tokens, idx, options, env, self)
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
    // DocumentEmbed rendered into them. v-html knows nothing about those
    // component trees, so hosts whose DOM a later render replaced are
    // unmounted here (and every remaining one in beforeUnmount).
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
  padding: 2rem;
  gap: 2rem;
  align-items: flex-start;
}

.note-main-content {
  flex: 1;
  min-width: 0;
}

.note-content {
  background: rgba(12, 13, 29, 0.6);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(138, 92, 245, 0.3);
  border-radius: 12px;
  padding: 2rem;
  box-shadow: 0 4px 20px rgba(75, 0, 130, 0.3);
}

.loading, .error {
  text-align: center;
  padding: 3rem;
}

.error {
  color: var(--status-error);
}

.note-header {
  margin-bottom: 2rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--border-light);
}

.note-header h1 {
  margin: 0 0 0.5rem 0;
  display: inline-block;
  color: var(--text-primary);
  font-weight: 600;
}

.note-header-top {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.edit-note-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 34px;
  height: 34px;
  background: transparent;
  border: none;
  color: var(--text-tertiary);
  border-radius: 50%;
  cursor: pointer;
  transition: all 0.15s ease;
}

.edit-note-btn:hover {
  background: rgba(138, 92, 245, 0.15);
  color: var(--interactive-primaryHover);
}

.edit-note-btn .mdi {
  font-size: 1.1rem;
}

/* ── Editor ─────────────────────────────────────────────────── */
.editor-shell {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.editor-header {
  border-bottom: 1px solid var(--border-light);
  padding-bottom: 1rem;
}

.editor-header h1 {
  margin: 0 0 0.25rem 0;
  color: var(--text-primary);
  font-weight: 600;
}

.editor-path {
  margin: 0;
  color: var(--text-tertiary);
  font-size: 0.875rem;
  font-family: 'SF Mono', 'Monaco', 'Courier New', monospace;
}

.editor-tabs {
  display: flex;
  gap: 0.25rem;
  border-bottom: 1px solid var(--border-light);
}

.editor-tab {
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--text-secondary);
  padding: 0.625rem 1rem;
  font-size: 0.875rem;
  cursor: pointer;
  transition: all 0.15s ease;
}

.editor-tab:hover {
  color: var(--text-primary);
}

.editor-tab.active {
  color: var(--text-primary);
  border-bottom-color: var(--interactive-primary);
}

.editor-textarea {
  width: 100%;
  min-height: 50vh;
  resize: vertical;
  background: rgba(8, 9, 20, 0.6);
  border: 1px solid var(--border-light);
  border-radius: 8px;
  padding: 1rem;
  color: var(--text-primary);
  font-family: 'SF Mono', 'Monaco', 'Courier New', monospace;
  font-size: 1rem;
  line-height: 1.6;
}

.editor-textarea:focus {
  outline: none;
  border-color: var(--interactive-primary);
}

.editor-preview {
  min-height: 50vh;
  padding: 1rem;
  border: 1px solid var(--border-light);
  border-radius: 8px;
  background: rgba(8, 9, 20, 0.3);
}

.editor-preview :deep(.preview-empty) {
  color: var(--text-tertiary);
  font-style: italic;
}

.editor-error {
  color: var(--status-error, #f87171);
  background: rgba(248, 113, 113, 0.1);
  border: 1px solid rgba(248, 113, 113, 0.25);
  padding: 0.625rem 0.9rem;
  border-radius: 8px;
  font-size: 0.875rem;
  margin: 0;
}

.editor-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
}

.editor-btn {
  padding: 0.625rem 1.25rem;
  border-radius: 8px;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  border: 1px solid transparent;
}

.editor-btn.cancel {
  background: transparent;
  border-color: var(--border-light);
  color: var(--text-secondary);
}

.editor-btn.cancel:hover {
  background: var(--interactive-secondary);
  color: var(--text-primary);
}

.editor-btn.save {
  background: var(--interactive-primary);
  border-color: var(--interactive-primary);
  color: white;
}

.editor-btn.save:hover {
  background: var(--interactive-primaryHover);
}

.editor-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: btn-spin 0.7s linear infinite;
}

@keyframes btn-spin {
  to { transform: rotate(360deg); }
}

.not-found {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 0.75rem;
  max-width: 420px;
  margin: 3rem auto;
  padding: 2.5rem 2rem;
}

.not-found .mdi {
  font-size: 3rem;
  color: var(--text-tertiary);
}

.not-found h2 {
  margin: 0;
  color: var(--text-primary);
}

.not-found-path {
  font-family: 'SF Mono', 'Monaco', 'Courier New', monospace;
  color: var(--text-tertiary);
  margin: 0 0 0.5rem 0;
}

.note-meta {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.note-breadcrumb {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  font-size: 0.875rem;
  color: var(--text-secondary);
}

.breadcrumb-link {
  color: var(--text-secondary);
  text-decoration: none;
  transition: color 0.2s ease;
}

.breadcrumb-link:hover {
  color: var(--interactive-primary);
}

.breadcrumb-separator {
  color: var(--text-tertiary);
  margin: 0 0.125rem;
}

.breadcrumb-current {
  color: var(--text-primary);
  font-weight: 500;
}

.tags {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.tag {
  background: rgba(138, 92, 245, 0.2);
  color: #a78bfa;
  padding: 0.25rem 0.75rem;
  border-radius: 12px;
  font-size: 0.875rem;
  border: 1px solid rgba(138, 92, 245, 0.3);
}

.tag.clickable {
  cursor: pointer;
  transition: all 0.2s ease;
}

.tag.clickable:hover {
  background: rgba(138, 92, 245, 0.4);
  border-color: rgba(138, 92, 245, 0.6);
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(138, 92, 245, 0.3);
}

.markdown-content {
  line-height: 1.7;
  color: var(--text-primary);
  font-size: 1rem;
}

.markdown-content :deep(h1),
.markdown-content :deep(h2),
.markdown-content :deep(h3),
.markdown-content :deep(h4),
.markdown-content :deep(h5),
.markdown-content :deep(h6) {
  margin-top: 2rem;
  margin-bottom: 1rem;
  color: var(--text-primary);
  font-weight: 600;
}

.markdown-content :deep(h1) {
  font-size: 1.875rem;
  padding-bottom: 0.5rem;
  border-bottom: 2px solid var(--border-light);
}

.markdown-content :deep(h2) {
  font-size: 1.5rem;
  padding-bottom: 0.25rem;
  border-bottom: 1px solid var(--border-light);
}

.markdown-content :deep(h3) {
  font-size: 1.25rem;
}

.markdown-content :deep(p) {
  margin-bottom: 1rem;
}

.markdown-content :deep(code) {
  background: var(--bg-tertiary);
  color: var(--text-primary);
  padding: 0.2rem 0.4rem;
  border-radius: 4px;
  font-family: 'SF Mono', 'Monaco', 'Courier New', monospace;
  font-size: 0.9em;
}

.markdown-content :deep(pre) {
  background: var(--bg-tertiary);
  padding: 1rem;
  border-radius: 8px;
  overflow-x: auto;
  margin-bottom: 1rem;
  border: 1px solid var(--border-light);
}

.markdown-content :deep(pre code) {
  background: transparent;
  padding: 0;
}

.markdown-content :deep(code.dice-roll) {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  background: rgba(138, 92, 245, 0.18);
  border: 1px solid rgba(138, 92, 245, 0.4);
  color: #c4b5fd;
  cursor: pointer;
  transition: background 0.2s ease, border-color 0.2s ease, transform 0.2s ease;
}

.markdown-content :deep(code.dice-roll .mdi) {
  font-size: 0.95em;
}

.markdown-content :deep(code.dice-roll:hover) {
  background: rgba(138, 92, 245, 0.35);
  border-color: rgba(138, 92, 245, 0.7);
  transform: translateY(-1px);
}

.markdown-content :deep(.doc-embed) {
  display: block;
}

.markdown-content :deep(.doc-embed-placeholder) {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  color: var(--text-secondary);
  font-family: monospace;
  font-size: 0.85em;
}

.markdown-content :deep(code.song-link) {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  background: rgba(45, 212, 191, 0.18);
  border: 1px solid rgba(45, 212, 191, 0.4);
  color: #5eead4;
  cursor: pointer;
  transition: background 0.2s ease, border-color 0.2s ease, transform 0.2s ease;
}

.markdown-content :deep(code.song-link .mdi) {
  font-size: 0.95em;
}

.markdown-content :deep(code.song-link:hover) {
  background: rgba(45, 212, 191, 0.35);
  border-color: rgba(45, 212, 191, 0.7);
  transform: translateY(-1px);
}

.markdown-content :deep(code.song-link.loading) {
  opacity: 0.6;
  cursor: wait;
}

.markdown-content :deep(code.song-link.song-link-error) {
  background: rgba(239, 68, 68, 0.2);
  border-color: rgba(239, 68, 68, 0.6);
  color: #fca5a5;
}

.markdown-content :deep(a) {
  color: var(--interactive-primary);
  text-decoration: none;
  transition: all 0.2s ease;
  position: relative;
  padding: 0 2px;
}

.markdown-content :deep(a:hover) {
  color: var(--interactive-primaryHover);
  text-decoration: underline;
  background: rgba(138, 92, 245, 0.1);
  border-radius: 4px;
  padding: 0 2px;
}

.markdown-content :deep(a[data-note-link]:hover) {
  box-shadow: 0 0 8px rgba(138, 92, 245, 0.3);
}

.markdown-content :deep(blockquote) {
  border-left: 3px solid var(--border-dark);
  margin: 1rem 0;
  padding-left: 1rem;
  color: var(--text-secondary);
  font-style: italic;
}

.markdown-content :deep(ul),
.markdown-content :deep(ol) {
  margin-bottom: 1rem;
  padding-left: 2rem;
}

.markdown-content :deep(li) {
  margin-bottom: 0.5rem;
}

/* Embedded charts/vistas style their own images (pin icons, vista assets).
   max-height keeps a tall 9:16 portrait from towering over a 16:9 one at
   the same column width — both cap out around the same on-screen size. */
.markdown-content :deep(img:not(.document-embed img)) {
  max-width: 100%;
  max-height: 60vh;
  height: auto;
  border-radius: 8px;
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
  margin: 1.5rem auto;
  line-height: 0;
  border-radius: 8px;
  overflow: visible;
}

.markdown-content :deep(.img-screen-btn) {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  background: rgba(10, 10, 25, 0.75);
  border: 1px solid rgba(138, 92, 245, 0.5);
  color: #c4b5fd;
  padding: 0.35rem 0.65rem;
  border-radius: 8px;
  font-size: 0.8rem;
  font-family: inherit;
  cursor: pointer;
  backdrop-filter: blur(8px);
  opacity: 0;
  transform: translateY(-4px);
  transition: opacity 0.2s ease, transform 0.2s ease, background 0.2s ease, border-color 0.2s ease;
  z-index: 5;
  pointer-events: none;
  white-space: nowrap;
}

.markdown-content :deep(.img-screen-wrapper:hover .img-screen-btn) {
  opacity: 1;
  transform: translateY(0);
  pointer-events: auto;
}

.markdown-content :deep(.img-screen-btn:hover) {
  background: rgba(138, 92, 245, 0.4);
  border-color: rgba(138, 92, 245, 0.8);
  color: #fff;
  box-shadow: 0 0 12px rgba(138, 92, 245, 0.4);
}

.markdown-content :deep(.img-screen-btn.sent) {
  background: rgba(34, 211, 238, 0.4) !important;
  border-color: rgba(34, 211, 238, 0.8) !important;
  color: #fff !important;
  box-shadow: 0 0 15px rgba(34, 211, 238, 0.5) !important;
}

.markdown-content :deep(.locked-asset) {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 1rem;
  color: var(--text-secondary);
  font-size: 0.9rem;
}

.markdown-content :deep(pre.mermaid) {
  background: transparent;
  border: none;
  padding: 1rem 0;
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
  margin-bottom: 1rem;
  border: 1px solid var(--border-light);
  border-radius: 8px;
  overflow: hidden;
}

.markdown-content :deep(th),
.markdown-content :deep(td) {
  border: 1px solid var(--border-light);
  padding: 0.75rem;
  text-align: left;
}

.markdown-content :deep(th) {
  background: var(--bg-secondary);
  font-weight: 600;
  color: var(--text-primary);
}

/* Obsidian-style callouts */
.markdown-content :deep(.callout) {
  --callout-color: #a78bfa;
  margin: 1rem 0;
  padding: 0.75rem 1rem;
  border-radius: 8px;
  border-left: 3px solid var(--callout-color);
  background: color-mix(in srgb, var(--callout-color) 12%, transparent);
}

.markdown-content :deep(.callout-title) {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0;
  font-weight: 600;
  color: var(--callout-color);
}

.markdown-content :deep(.callout-title .mdi) {
  font-size: 1.1rem;
}

.markdown-content :deep(.callout-content) {
  margin-top: 0.5rem;
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
