<template>
  <div class="note-view-container">
    <div class="note-main-content">
      <div v-if="loading" class="loading">
        <p>Loading note...</p>
      </div>
      
      <div v-else-if="error" class="error">
        <h2>Error</h2>
        <p>{{ error }}</p>
      </div>
      
      <div v-else-if="note" class="note-content">
        <header class="note-header">
          <h1>{{ note.title }}</h1>
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
    
    <RightSidebar v-if="note && !loading && !error" :note="note" />
  </div>
</template>

<script>
import axios from 'axios'
import MarkdownIt from 'markdown-it'
import mermaid from 'mermaid'
import { cachedFetch } from '@/api/cache'
import RightSidebar from '@/components/RightSidebar.vue'

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
    tertiaryColor: '#12132a'
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

    return {
      note: null,
      loading: true,
      error: null,
      md,
      prefetchCache: new Set(),
      prefetchTimeout: null,
      containerFolders: {}
    }
  },
  computed: {
    apiUrl() {
      return import.meta.env.VITE_API_URL || ''
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
      let html = this.md.render(this.note.content)
      
      // Add IDs to headers for ToC navigation
      let headerCount = {}
      html = html.replace(/<h([1-6])>(.*?)<\/h\1>/g, (match, level, content) => {
        // Strip tags from content to create a clean id
        const cleanContent = content.replace(/<[^>]+>/g, '')
        const idBase = cleanContent.toLowerCase().replace(/[^\w\s-]/g, '').replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '') || 'header'
        headerCount[idBase] = (headerCount[idBase] || 0) + 1
        const id = headerCount[idBase] > 1 ? `${idBase}-${headerCount[idBase] - 1}` : idBase
        return `<h${level} id="${id}">${content}</h${level}>`
      })
      
      html = html.replace(/src="\/(assets|vault-assets)\//g, `src="${this.apiUrl}/vault-assets/`)
      html = html.replace(/<a href="\/note\/([^"]+)"/g, (match, linkId) => {
        return `<a href="/note/${linkId}" data-note-link="${linkId}"`
      })
      return html
    }
  },
  methods: {
    filterByTag(tag) {
      this.addTagFilter(tag)
    },
    async fetchNote() {
      this.loading = true
      this.error = null
      
      try {
        const cacheKey = `note:${this.notePath}`
        
        this.note = await cachedFetch(cacheKey, () =>
          axios.get(`${this.apiUrl}/api/note/${this.notePath}`)
            .then(r => r.data)
        )
        this.loading = false
        
        this.setupLinkPrefetch()
        this.renderMermaidDiagrams()

        this.prefetchLinkedNotes(this.note.links || [])
      } catch (err) {
        this.error = err.response?.data?.detail || err.message
        this.loading = false
      }
    },
    prefetchLinkedNotes(links) {
      if (!links || links.length === 0) return

      const prefetchFn = () => {
        links.slice(0, 5).forEach(linkId => {
          if (this.prefetchCache.has(linkId)) return
          
          this.prefetchCache.add(linkId)
          
          const cacheKey = `note:${linkId}`
          cachedFetch(cacheKey, () =>
            axios.get(`${this.apiUrl}/api/note/${linkId}`, {
              timeout: 2000
            })
              .then(r => r.data)
          ).catch(() => {
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
      
      const cacheKey = `note:${linkId}`
      cachedFetch(cacheKey, () =>
        axios.get(`${this.apiUrl}/api/note/${linkId}`, {
          timeout: 1500
        })
          .then(r => r.data)
      ).catch(() => {
      })
    },
    setupLinkPrefetch() {
      this.$nextTick(() => {
        const content = this.$refs.markdownContent
        if (!content) return
        
        const links = content.querySelectorAll('a[data-note-link]')
        links.forEach(link => {
          const linkId = link.getAttribute('data-note-link')
          if (!linkId) return
          
          link.addEventListener('mouseenter', () => {
            this.onLinkMouseEnter(linkId)
          }, { once: false })
        })

        this.setupImageScreenButtons()
      })
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
            await axios.post(`${this.apiUrl}/api/screen/display`, { url, title })
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
        const response = await axios.get(`${this.apiUrl}/api/container-folders`)
        this.containerFolders = response.data
      } catch (err) {
        console.error('Error loading container folders:', err)
      }
    }
  },
  mounted() {
    this.loadContainerFolders()
  },
  watch: {
    notePath: {
      immediate: true,
      handler() {
        this.fetchNote()
      }
    }
  },
  beforeUnmount() {
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
  background: linear-gradient(90deg, #22d3ee 0%, #a78bfa 50%, #f472b6 100%);
  background-size: 100% 100%;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
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
  font-size: 0.9rem;
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
  font-size: 0.85rem;
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

.markdown-content :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: 8px;
  margin: 0;
  display: block;
}

/* Screen button wrapper */
.markdown-content :deep(.img-screen-wrapper) {
  display: block;
  position: relative;
  margin: 1.5rem 0;
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
  border-radius: 7px;
  font-size: 0.78rem;
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
</style>
