<template>
  <div class="note-view">
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
                v-if="crumb.path" 
                :to="'/note/' + encodeURIComponent(crumb.path)"
                class="breadcrumb-link"
              >
                {{ crumb.name }}
              </router-link>
              <span v-else class="breadcrumb-current">{{ crumb.name }}</span>
              <span v-if="index < breadcrumbs.length - 1" class="breadcrumb-separator">/</span>
            </template>
          </nav>
          <div v-if="note.tags.length" class="tags">
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
</template>

<script>
import axios from 'axios'
import MarkdownIt from 'markdown-it'
import { cachedFetch, apiCache, invalidateCacheByResource } from '@/api/cache'

export default {
  name: 'NoteView',
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
    return {
      note: null,
      loading: true,
      error: null,
      md: new MarkdownIt({
        html: true,
        linkify: true,
        typographer: true,
        breaks: true
      }),
      prefetchCache: new Set(),
      prefetchTimeout: null,
      containerFolders: new Set()
    }
  },
  computed: {
    apiUrl() {
      return import.meta.env.VITE_API_URL || 'http://localhost:8000'
    },
    breadcrumbs() {
      if (!this.note) return []
      
      // Use note.id which doesn't have .md extension
      const parts = this.note.id.split('/')
      const crumbs = []
      
      for (let i = 0; i < parts.length; i++) {
        const name = parts[i]
        const isLast = i === parts.length - 1
        
        if (isLast) {
          // Current note - not a link
          crumbs.push({ name, path: null })
        } else {
          const folderPath = parts.slice(0, i + 1).join('/')
          
          if (this.containerFolders.has(name)) {
            // Known container folder - don't create a link
            crumbs.push({ name, path: null })
          } else {
            // Likely a folder with an index note (folder/folder pattern)
            // e.g., "Esparragus Totalus" folder should link to "Oneshots/Esparragus Totalus/Esparragus Totalus"
            const folderNotePath = folderPath + '/' + name
            crumbs.push({ name, path: folderNotePath })
          }
        }
      }
      
      return crumbs
    },
    renderedContent() {
      if (!this.note) return ''
      let html = this.md.render(this.note.content)
      // Replace relative asset URLs with absolute backend URLs
      html = html.replace(/src="\/assets\//g, `src="${this.apiUrl}/assets/`)
      // Enhance note links with data attributes for prefetch
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
        
        // Usar cachedFetch para obtener la nota con caché automático
        this.note = await cachedFetch(cacheKey, () =>
          axios.get(`${this.apiUrl}/api/note/${this.notePath}`)
            .then(r => r.data)
        )
        this.loading = false
        
        // Setup link prefetch listeners
        this.setupLinkPrefetch()
        
        // Prefetch linked notes en background
        this.prefetchLinkedNotes(this.note.links)
      } catch (err) {
        this.error = err.response?.data?.detail || err.message
        this.loading = false
      }
    },
    prefetchLinkedNotes(links) {
      if (!links || links.length === 0) return

      // Usar requestIdleCallback si disponible
      const prefetchFn = () => {
        // Prefetch máximo 5 links
        links.slice(0, 5).forEach(linkId => {
          // Evitar prefetch duplicado
          if (this.prefetchCache.has(linkId)) return
          
          this.prefetchCache.add(linkId)
          
          // Usar cachedFetch para prefetch con caché automático
          const cacheKey = `note:${linkId}`
          cachedFetch(cacheKey, () =>
            axios.get(`${this.apiUrl}/api/note/${linkId}`, {
              timeout: 2000  // No esperar mucho
            })
              .then(r => r.data)
          ).catch(() => {
            // Ignorar errores en prefetch silenciosamente
          })
        })
      }

      // Cleanup timeout anterior si existe
      if (this.prefetchTimeout) {
        clearTimeout(this.prefetchTimeout)
      }

      if ('requestIdleCallback' in window) {
        requestIdleCallback(prefetchFn)
      } else {
        // Fallback: ejecutar después de 1 segundo
        this.prefetchTimeout = setTimeout(prefetchFn, 1000)
      }
    },
    onLinkMouseEnter(linkId) {
      // Prefetch individual cuando el usuario pasa el mouse sobre un link
      if (this.prefetchCache.has(linkId)) return
      
      this.prefetchCache.add(linkId)
      
      // Usar cachedFetch para prefetch con caché automático
      const cacheKey = `note:${linkId}`
      cachedFetch(cacheKey, () =>
        axios.get(`${this.apiUrl}/api/note/${linkId}`, {
          timeout: 1500
        })
          .then(r => r.data)
      ).catch(() => {
        // Ignorar errores
      })
    },
    setupLinkPrefetch() {
      this.$nextTick(() => {
        const content = this.$refs.markdownContent
        if (!content) return
        
        // Encontrar todos los links internos con data-note-link
        const links = content.querySelectorAll('a[data-note-link]')
        links.forEach(link => {
          const linkId = link.getAttribute('data-note-link')
          if (!linkId) return
          
          // Agregar event listener para prefetch on hover
          link.addEventListener('mouseenter', () => {
            this.onLinkMouseEnter(linkId)
          }, { once: false })
        })
      })
    },
    async loadContainerFolders() {
      try {
        const response = await axios.get(`${this.apiUrl}/api/container-folders`)
        this.containerFolders = new Set(response.data)
      } catch (err) {
        console.error('Error loading container folders:', err)
        // Si falla, simplemente no habrá carpetas contenedoras
        // y todos los directorios se tratarán como potenciales links
      }
    }
  },
  mounted() {
    // Load container folders once on component mount
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
.note-view {
  flex: 1;
  overflow-y: auto;
  padding: 2rem;
  max-width: 900px;
  margin: 0 auto;
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
  padding-bottom: 1.5rem;
  position: relative;
  border-bottom: none;
  display: inline-block;
  width: 100%;
}

.markdown-content :deep(h1)::after,
.markdown-content :deep(h1)::before {
  content: '';
  position: absolute;
  left: 0;
  width: 100%;
  pointer-events: none;
}

.markdown-content :deep(h1)::after {
  bottom: 0;
  height: 35px;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 1400 160' preserveAspectRatio='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cdefs%3E%3Cfilter id='glow' x='-50%25' y='-50%25' width='200%25' height='200%25'%3E%3CfeGaussianBlur stdDeviation='8' result='blur'/%3E%3CfeMerge%3E%3CfeMergeNode in='blur'/%3E%3CfeMergeNode in='SourceGraphic'/%3E%3C/feMerge%3E%3C/filter%3E%3ClinearGradient id='g1' x1='0%25' x2='100%25' y1='0%25' y2='100%25'%3E%3Cstop offset='0%25' stop-color='%23b6f0ff'/%3E%3Cstop offset='60%25' stop-color='%237a6bff'/%3E%3Cstop offset='100%25' stop-color='%23ff88e6'/%3E%3C/linearGradient%3E%3ClinearGradient id='g2' x1='0%25' x2='100%25' y1='100%25' y2='0%25'%3E%3Cstop offset='0%25' stop-color='%23ffb3ff'/%3E%3Cstop offset='50%25' stop-color='%238ccaff'/%3E%3Cstop offset='100%25' stop-color='%23caa8ff'/%3E%3C/linearGradient%3E%3C/defs%3E%3Cpath stroke='url(%23g1)' fill='none' stroke-width='8' stroke-linecap='round' stroke-linejoin='round' filter='url(%23glow)' opacity='0.8' d='M10 90 C200 10, 450 150, 700 70 C950 -10, 1200 160, 1390 80'/%3E%3Cpath stroke='url(%23g2)' fill='none' stroke-width='5' stroke-linecap='round' stroke-linejoin='round' filter='url(%23glow)' opacity='0.6' d='M20 110 C230 40, 400 140, 650 100 C900 60, 1150 140, 1380 60'/%3E%3C/svg%3E");
  background-size: 100% 100%;
  background-repeat: no-repeat;
  opacity: 0.85;
  animation: nebulaWave1 4s ease-in-out infinite;
}

.markdown-content :deep(h1)::before {
  bottom: 2px;
  height: 30px;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 1400 160' preserveAspectRatio='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cdefs%3E%3Cfilter id='glow3' x='-50%25' y='-50%25' width='200%25' height='200%25'%3E%3CfeGaussianBlur stdDeviation='6' result='blur'/%3E%3CfeMerge%3E%3CfeMergeNode in='blur'/%3E%3CfeMergeNode in='SourceGraphic'/%3E%3C/feMerge%3E%3C/filter%3E%3ClinearGradient id='g3' x1='100%25' x2='0%25' y1='0%25' y2='100%25'%3E%3Cstop offset='0%25' stop-color='%23ffffff'/%3E%3Cstop offset='60%25' stop-color='%23b0e1ff'/%3E%3Cstop offset='100%25' stop-color='%23ffd4ff'/%3E%3C/linearGradient%3E%3C/defs%3E%3Cpath stroke='url(%23g3)' fill='none' stroke-width='3' stroke-linecap='round' stroke-linejoin='round' filter='url(%23glow3)' opacity='0.9' d='M30 70 C260 20, 520 120, 780 90 C1040 60, 1260 140, 1370 40'/%3E%3C/svg%3E");
  background-size: 100% 100%;
  background-repeat: no-repeat;
  opacity: 0.9;
  animation: nebulaWave2 5s ease-in-out infinite;
}

@keyframes nebulaWave1 {
  0%, 100% {
    transform: translateY(0);
  }
  25% {
    transform: translateY(-4px);
  }
  75% {
    transform: translateY(4px);
  }
}

@keyframes nebulaWave2 {
  0%, 100% {
    transform: translateY(0);
  }
  33% {
    transform: translateY(5px);
  }
  66% {
    transform: translateY(-5px);
  }
}

.markdown-content :deep(h2) {
  font-size: 1.5rem;
  padding-bottom: 1rem;
  position: relative;
  border-bottom: none;
  display: inline-block;
  width: 100%;
}

.markdown-content :deep(h2)::after,
.markdown-content :deep(h2)::before {
  content: '';
  position: absolute;
  left: 0;
  width: 70%;
  pointer-events: none;
}

.markdown-content :deep(h2)::after {
  bottom: 0;
  height: 18px;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 1400 160' preserveAspectRatio='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cdefs%3E%3Cfilter id='glow2' x='-50%25' y='-50%25' width='200%25' height='200%25'%3E%3CfeGaussianBlur stdDeviation='6' result='blur'/%3E%3CfeMerge%3E%3CfeMergeNode in='blur'/%3E%3CfeMergeNode in='SourceGraphic'/%3E%3C/feMerge%3E%3C/filter%3E%3ClinearGradient id='h2g1' x1='0%25' x2='100%25' y1='0%25' y2='100%25'%3E%3Cstop offset='0%25' stop-color='%238ccaff'/%3E%3Cstop offset='60%25' stop-color='%237a6bff'/%3E%3Cstop offset='100%25' stop-color='transparent'/%3E%3C/linearGradient%3E%3C/defs%3E%3Cpath stroke='url(%23h2g1)' fill='none' stroke-width='4' stroke-linecap='round' stroke-linejoin='round' filter='url(%23glow2)' opacity='0.7' d='M10 80 C300 30, 600 130, 900 70 C1100 30, 1300 90, 1400 60'/%3E%3C/svg%3E");
  background-size: 100% 100%;
  background-repeat: no-repeat;
  opacity: 0.7;
  animation: nebulaWaveH2a 5s ease-in-out infinite;
}

.markdown-content :deep(h2)::before {
  bottom: 2px;
  height: 14px;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 1400 160' preserveAspectRatio='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cdefs%3E%3Cfilter id='glow2b' x='-50%25' y='-50%25' width='200%25' height='200%25'%3E%3CfeGaussianBlur stdDeviation='4' result='blur'/%3E%3CfeMerge%3E%3CfeMergeNode in='blur'/%3E%3CfeMergeNode in='SourceGraphic'/%3E%3C/feMerge%3E%3C/filter%3E%3ClinearGradient id='h2g2' x1='0%25' x2='100%25' y1='100%25' y2='0%25'%3E%3Cstop offset='0%25' stop-color='%23caa8ff'/%3E%3Cstop offset='70%25' stop-color='%23b6f0ff' stop-opacity='0.5'/%3E%3Cstop offset='100%25' stop-color='transparent'/%3E%3C/linearGradient%3E%3C/defs%3E%3Cpath stroke='url(%23h2g2)' fill='none' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' filter='url(%23glow2b)' opacity='0.5' d='M10 100 C350 50, 650 120, 950 80 C1150 50, 1350 100, 1400 70'/%3E%3C/svg%3E");
  background-size: 100% 100%;
  background-repeat: no-repeat;
  opacity: 0.6;
  animation: nebulaWaveH2b 6s ease-in-out infinite;
}

@keyframes nebulaWaveH2a {
  0%, 100% {
    transform: translateY(0);
  }
  25% {
    transform: translateY(-3px);
  }
  75% {
    transform: translateY(3px);
  }
}

@keyframes nebulaWaveH2b {
  0%, 100% {
    transform: translateY(0);
  }
  33% {
    transform: translateY(3px);
  }
  66% {
    transform: translateY(-3px);
  }
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
  margin: 1.5rem 0;
  display: block;
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

.backlinks {
  margin-top: 3rem;
  padding-top: 2rem;
  border-top: 1px solid var(--border-light);
}

.backlinks h3 {
  margin-bottom: 1rem;
  color: var(--text-secondary);
  font-size: 1.1rem;
  font-weight: 600;
}

.backlinks ul {
  list-style: none;
  padding: 0;
}

.backlinks li {
  margin-bottom: 0.5rem;
}

.backlinks a {
  color: var(--interactive-primary);
  text-decoration: none;
  transition: color 0.15s ease;
}

.backlinks a:hover {
  color: var(--interactive-primaryHover);
  text-decoration: underline;
}
</style>
