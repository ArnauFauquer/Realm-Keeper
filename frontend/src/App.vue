<template>
  <div id="app">
    <NebulaBackground />
    <div class="main-container">
      <div class="tabs-header">
        <button 
          v-for="tab in tabs" 
          :key="tab.id"
          :class="['tab-button', { active: activeTab === tab.id }]"
          @click="activeTab = tab.id"
        >
          <span :class="tab.icon"></span>
          <span class="tab-label">{{ tab.label }}</span>
        </button>
        <div class="app-title">
          <span class="mdi mdi-orbit"></span>
          <span class="title-text">RealmKeeper</span>
        </div>
      </div>
      <main class="main-content">
        <div v-if="activeTab === 'wiki'" class="wiki-container">
          <NotesSidebar ref="notesSidebar" />
          <div class="wiki-content">
            <router-view />
          </div>
        </div>
        <div v-else-if="activeTab === 'graph'" class="tab-content full-size">
          <router-view />
        </div>
        <div v-else-if="activeTab === 'chat'" class="tab-content chat-tab">
          <ChatView :apiUrl="apiUrl" />
        </div>
        <div v-else-if="activeTab === 'admin'" class="tab-content">
          <h2><span class="mdi mdi-cog"></span> Admin</h2>
          
          <!-- LightRAG Status Section -->
          <div class="admin-section">
            <h3><span class="mdi mdi-brain"></span> LightRAG Knowledge Base</h3>
            <div v-if="ragStatus" class="rag-status">
              <div class="status-grid">
                <div class="status-item">
                  <span class="status-label">Status:</span>
                  <span :class="['status-badge', ragStatus.initialized ? 'success' : 'warning']">
                    <span class="mdi" :class="ragStatus.initialized ? 'mdi-check-circle' : 'mdi-alert'"></span>
                    {{ ragStatus.initialized ? 'Initialized' : 'Not Initialized' }}
                  </span>
                </div>
                <div class="status-item">
                  <span class="status-label">Indexing:</span>
                  <span :class="['status-badge', ragStatus.indexing ? 'active' : 'idle']">
                    <span class="mdi" :class="ragStatus.indexing ? 'mdi-sync mdi-spin' : 'mdi-circle-small'"></span>
                    {{ ragStatus.indexing ? 'In Progress' : 'Idle' }}
                  </span>
                </div>
                
                <!-- Progress bar when indexing -->
                <div v-if="ragStatus.indexing" class="indexing-progress">
                  <div class="progress-info">
                    <span class="progress-percent">{{ ragStatus.indexing_percent || 0 }}%</span>
                    <span class="progress-count">{{ ragStatus.indexing_progress || 0 }} / {{ ragStatus.indexing_total || 0 }} files</span>
                  </div>
                  <div class="progress-bar-container">
                    <div 
                      class="progress-bar-fill" 
                      :style="{ width: (ragStatus.indexing_percent || 0) + '%' }"
                    ></div>
                  </div>
                  <div class="current-file" v-if="ragStatus.indexing_current_file">
                    <span class="mdi mdi-file-document-outline"></span> {{ ragStatus.indexing_current_file }}
                  </div>
                </div>
                
                <div class="status-item">
                  <span class="status-label">LLM Model:</span>
                  <span class="status-value">{{ ragStatus.llm_model }}</span>
                </div>
                <div class="status-item">
                  <span class="status-label">Embedding Model:</span>
                  <span class="status-value">{{ ragStatus.embedding_model }}</span>
                </div>
              </div>
              <div class="rag-actions">
                <button 
                  @click="indexVault" 
                  :disabled="indexing || ragStatus.indexing || deleting"
                  class="action-button primary"
                >
                  <span class="mdi" :class="indexing || ragStatus.indexing ? 'mdi-sync mdi-spin' : 'mdi-book-multiple'"></span>
                  {{ indexing || ragStatus.indexing ? 'Indexing...' : 'Index Vault' }}
                </button>
                <button 
                  @click="fetchRagStatus" 
                  :disabled="indexing || deleting"
                  class="action-button secondary"
                >
                  <span class="mdi mdi-refresh"></span> Refresh Status
                </button>
                <button 
                  @click="deleteIndex" 
                  :disabled="indexing || ragStatus.indexing || deleting"
                  class="action-button danger"
                >
                  <span class="mdi" :class="deleting ? 'mdi-delete-clock' : 'mdi-delete'"></span>
                  {{ deleting ? 'Deleting...' : 'Delete Index' }}
                </button>
              </div>
              <div v-if="indexResult" class="index-result" :class="indexResult.status">
                <p v-if="indexResult.status === 'success'">
                  <span class="mdi mdi-check-circle"></span> Indexed {{ indexResult.indexed_files }} / {{ indexResult.total_files }} files
                </p>
                <p v-else-if="indexResult.status === 'error'">
                  <span class="mdi mdi-alert-circle"></span> Error: {{ indexResult.message }}
                </p>
                <div v-if="indexResult.errors && indexResult.errors.length > 0" class="error-list">
                  <details>
                    <summary>{{ indexResult.errors.length }} errors occurred</summary>
                    <ul>
                      <li v-for="(error, i) in indexResult.errors.slice(0, 5)" :key="i">{{ error }}</li>
                      <li v-if="indexResult.errors.length > 5">...and {{ indexResult.errors.length - 5 }} more</li>
                    </ul>
                  </details>
                </div>
              </div>
              <div v-if="deleteResult" class="index-result" :class="deleteResult.status">
                <p v-if="deleteResult.status === 'success'">
                  <span class="mdi mdi-delete-circle"></span> {{ deleteResult.message }}
                </p>
                <p v-else-if="deleteResult.status === 'error'">
                  <span class="mdi mdi-alert-circle"></span> Error: {{ deleteResult.message }}
                </p>
              </div>
            </div>
            <div v-else class="loading-stats">
              <p>Loading LightRAG status...</p>
            </div>
          </div>

          <!-- Vault Info Section -->
          <div class="admin-section">
            <h3><span class="mdi mdi-folder-outline"></span> Vault Information</h3>
            <div class="stats" v-if="vaultInfo">
              <p><strong>Total notes:</strong> {{ vaultInfo.total_notes }}</p>
              <p><strong>Path:</strong> {{ vaultInfo.vault_path }}</p>
              <p v-if="vaultInfo.repo_url">
                <strong>Repository:</strong> {{ vaultInfo.repo_url }}
              </p>
              <button v-if="vaultInfo.repo_url" @click="syncVault" :disabled="syncing" class="action-button primary">
                <span class="mdi" :class="syncing ? 'mdi-sync mdi-spin' : 'mdi-sync'"></span>
                {{ syncing ? 'Syncing...' : 'Sync Vault' }}
              </button>
            </div>
            <div v-else class="loading-stats">
              <p>Loading information...</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  </div>
</template>

<script>
import NotesSidebar from './components/NotesSidebar.vue'
import NebulaBackground from './components/NebulaBackground.vue'
import ChatView from './components/ChatView.vue'
import axios from 'axios'
import { applyTheme } from './config/theme'

export default {
  name: 'App',
  components: {
    NotesSidebar,
    NebulaBackground,
    ChatView
  },
  provide() {
    return {
      addTagFilter: this.addTagFilter
    }
  },
  data() {
    return {
      activeTab: 'wiki',
      tabs: [
        { id: 'wiki', label: 'Wiki', icon: 'mdi mdi-book-open-page-variant' },
        { id: 'graph', label: 'Graph', icon: 'mdi mdi-graph-outline' },
        { id: 'chat', label: 'Chat', icon: 'mdi mdi-message-text-outline' },
        { id: 'admin', label: 'Admin', icon: 'mdi mdi-cog-outline' }
      ],
      vaultInfo: null,
      syncing: false,
      ragStatus: null,
      indexing: false,
      indexResult: null,
      ragStatusInterval: null,
      deleting: false,
      deleteResult: null
    }
  },
  computed: {
    apiUrl() {
      return import.meta.env.VITE_API_URL || 'http://localhost:8000'
    }
  },
  methods: {
    async fetchVaultInfo() {
      try {
        const response = await axios.get(`${this.apiUrl}/api/vault/info`)
        this.vaultInfo = response.data
      } catch (err) {
        console.error('Error fetching vault info:', err)
      }
    },
    async syncVault() {
      this.syncing = true
      try {
        await axios.post(`${this.apiUrl}/api/sync`)
        alert('Vault synced successfully')
        await this.fetchVaultInfo()
        window.location.reload()
      } catch (err) {
        alert('Error syncing vault: ' + err.message)
      } finally {
        this.syncing = false
      }
    },
    async fetchRagStatus() {
      try {
        const response = await axios.get(`${this.apiUrl}/api/chat/status`)
        this.ragStatus = response.data
      } catch (err) {
        console.error('Error fetching RAG status:', err)
        this.ragStatus = null
      }
    },
    async indexVault() {
      this.indexing = true
      this.indexResult = null
      this.deleteResult = null
      try {
        const response = await axios.post(`${this.apiUrl}/api/chat/index`, {})
        this.indexResult = response.data
        // Start fast polling for progress updates
        this.startFastPolling()
        await this.fetchRagStatus()
      } catch (err) {
        console.error('Error indexing vault:', err)
        this.indexResult = {
          status: 'error',
          message: err.response?.data?.detail || err.message
        }
        this.indexing = false
      }
      // Note: indexing flag stays true until we detect indexing is complete via status
    },
    startFastPolling() {
      // Poll every 1 second during indexing for real-time updates
      this.stopRagStatusPolling()
      this.ragStatusInterval = setInterval(async () => {
        await this.fetchRagStatus()
        // Stop fast polling when indexing is complete
        if (this.ragStatus && !this.ragStatus.indexing) {
          this.indexing = false
          this.stopRagStatusPolling()
          // Resume normal polling if still on admin tab
          if (this.activeTab === 'admin') {
            this.startRagStatusPolling()
          }
        }
      }, 1000)
    },
    async deleteIndex() {
      if (!confirm('Are you sure you want to delete the entire index? This will remove all knowledge graph data and embeddings.')) {
        return
      }
      
      this.deleting = true
      this.deleteResult = null
      this.indexResult = null
      try {
        const response = await axios.delete(`${this.apiUrl}/api/chat/index`)
        this.deleteResult = response.data
        await this.fetchRagStatus()
      } catch (err) {
        console.error('Error deleting index:', err)
        this.deleteResult = {
          status: 'error',
          message: err.response?.data?.detail || err.message
        }
      } finally {
        this.deleting = false
      }
    },
    startRagStatusPolling() {
      // Poll RAG status every 5 seconds when on admin tab
      this.ragStatusInterval = setInterval(() => {
        if (this.activeTab === 'admin') {
          this.fetchRagStatus()
        }
      }, 5000)
    },
    stopRagStatusPolling() {
      if (this.ragStatusInterval) {
        clearInterval(this.ragStatusInterval)
        this.ragStatusInterval = null
      }
    },
    addTagFilter(tag) {
      // Switch to wiki tab if not already there
      this.activeTab = 'wiki'
      // Wait for next tick to ensure sidebar is rendered, then call its method
      this.$nextTick(() => {
        if (this.$refs.notesSidebar) {
          this.$refs.notesSidebar.addTagToFilter(tag)
        }
      })
    }
  },
  watch: {
    '$route'(to) {
      // Update active tab based on route
      if (to.name === 'Graph') {
        this.activeTab = 'graph'
      } else {
        this.activeTab = 'wiki'
      }
    },
    activeTab(newTab) {
      // Navigate to graph route when graph tab is clicked
      if (newTab === 'graph' && this.$route.name !== 'Graph') {
        this.$router.push('/graph')
      } else if (newTab === 'wiki' && this.$route.name === 'Graph') {
        this.$router.push('/')
      } else if (newTab === 'admin') {
        this.fetchVaultInfo()
        this.fetchRagStatus()
        this.startRagStatusPolling()
      } else {
        this.stopRagStatusPolling()
      }
    }
  },
  mounted() {
    applyTheme()
    this.fetchVaultInfo()
  },
  beforeUnmount() {
    this.stopRagStatusPolling()
  }
}
</script>

<style>
:root {
  /* Nebula dark theme defaults */
  --bg-primary: #0c0d1d;
  --bg-secondary: #12132a;
  --bg-tertiary: #1a1b3a;
  --bg-elevated: #1f2045;
  --text-primary: #f0f0ff;
  --text-secondary: #a8a8c8;
  --text-tertiary: #6b6b8d;
  --border-light: rgba(138, 43, 226, 0.2);
  --border-medium: rgba(138, 43, 226, 0.35);
  --interactive-primary: #8a5cf5;
  --interactive-primaryHover: #a78bfa;
  --interactive-secondary: rgba(138, 43, 226, 0.15);
  --shadow-md: 0 2px 8px rgba(75, 0, 130, 0.3);
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', sans-serif;
  background: transparent;
  color: var(--text-primary);
}

#app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
  position: relative;
}

.main-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
  z-index: 1;
}

.tabs-header {
  display: flex;
  align-items: center;
  background: rgba(12, 13, 29, 0.85);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--border-light);
  padding: 0.5rem 1rem;
  gap: 0.25rem;
}

.app-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  margin-left: auto;
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--text-primary);
}

.app-title .mdi {
  font-size: 1.4rem;
  background: linear-gradient(90deg, #22d3ee 0%, #a78bfa 50%, #f472b6 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.app-title .title-text {
  background: linear-gradient(90deg, #22d3ee 0%, #a78bfa 50%, #f472b6 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.tab-button {
  padding: 0.625rem 1rem;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 0.9rem;
  font-weight: 500;
  color: var(--text-secondary);
  border-radius: 6px;
  transition: all 0.2s ease;
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.tab-button .mdi {
  font-size: 1.1rem;
}

.tab-button:hover {
  background: var(--interactive-secondary);
  color: var(--text-primary);
}

.tab-button.active {
  background: var(--interactive-secondary);
  box-shadow: 0 0 12px rgba(138, 92, 245, 0.3);
}

.tab-button.active .mdi,
.tab-button.active .tab-label {
  background: linear-gradient(90deg, #22d3ee 0%, #a78bfa 50%, #f472b6 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.main-content {
  flex: 1;
  overflow: hidden;
  background: transparent;
}

.wiki-container {
  display: flex;
  height: 100%;
  overflow: hidden;
}

.wiki-content {
  flex: 1;
  overflow-y: auto;
  background: rgba(12, 13, 29, 0.7);
  backdrop-filter: blur(8px);
}

.tab-content {
  padding: 2rem;
  max-width: 1200px;
  margin: 0 auto;
  overflow-y: auto;
  height: 100%;
  background: rgba(12, 13, 29, 0.7);
  backdrop-filter: blur(8px);
}

.tab-content h2 {
  margin-bottom: 1rem;
  color: var(--text-primary);
  font-weight: 600;
}

.tab-content p {
  color: var(--text-secondary);
  font-size: 1rem;
  line-height: 1.6;
}

.full-size {
  padding: 0;
  max-width: none;
  height: 100%;
  background: transparent;
}

.chat-tab {
  padding: 1rem;
  max-width: none;
  background: transparent;
}

/* Panel base styles - used by .stats and .admin-section */
.stats,
.admin-section {
  background-color: rgba(18, 19, 42, 0.8);
  padding: 1.5rem;
  border-radius: 12px;
  margin-bottom: 1.5rem;
  border: 1px solid var(--border-light);
  backdrop-filter: blur(8px);
}

.stats h3,
.admin-section h3 {
  margin-bottom: 1rem;
  color: var(--text-primary);
  font-weight: 600;
  font-size: 1.1rem;
}

.admin-section h3 {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.admin-section h3 .mdi {
  font-size: 1.25rem;
  color: var(--interactive-primary);
}

.tab-content h2 .mdi {
  font-size: 1.5rem;
  color: var(--interactive-primary);
  margin-right: 0.5rem;
}

.stats p {
  margin: 0.5rem 0;
  color: var(--text-secondary);
  font-size: 0.95rem;
}

.loading-stats {
  text-align: center;
  padding: 3rem;
  color: var(--text-secondary);
}

.rag-status {
  margin-top: 1rem;
}

.status-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.status-item {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.status-label {
  color: var(--text-tertiary);
  font-size: 0.85rem;
  font-weight: 500;
}

.status-value {
  color: var(--text-primary);
  font-size: 0.95rem;
  font-family: 'Fira Code', monospace;
}

.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.25rem 0.75rem;
  border-radius: 20px;
  font-size: 0.85rem;
  font-weight: 500;
  width: fit-content;
}

.status-badge .mdi {
  font-size: 1rem;
}

.status-badge.success {
  background: rgba(34, 197, 94, 0.2);
  color: #4ade80;
  border: 1px solid rgba(34, 197, 94, 0.3);
}

.status-badge.warning {
  background: rgba(234, 179, 8, 0.2);
  color: #fbbf24;
  border: 1px solid rgba(234, 179, 8, 0.3);
}

.status-badge.active {
  background: rgba(59, 130, 246, 0.2);
  color: #60a5fa;
  border: 1px solid rgba(59, 130, 246, 0.3);
}

.status-badge.idle {
  background: rgba(107, 114, 128, 0.2);
  color: #9ca3af;
  border: 1px solid rgba(107, 114, 128, 0.3);
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

/* Indexing Progress Styles */
.indexing-progress {
  grid-column: 1 / -1;
  background: rgba(59, 130, 246, 0.1);
  border: 1px solid rgba(59, 130, 246, 0.2);
  border-radius: 8px;
  padding: 1rem;
  margin-top: 0.5rem;
}

.progress-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}

.progress-percent {
  font-size: 1.25rem;
  font-weight: 600;
  color: #60a5fa;
}

.progress-count {
  font-size: 0.875rem;
  color: #9ca3af;
}

.progress-bar-container {
  width: 100%;
  height: 8px;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 4px;
  overflow: hidden;
}

.progress-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #3b82f6, #60a5fa);
  border-radius: 4px;
  transition: width 0.3s ease;
}

.current-file {
  margin-top: 0.5rem;
  font-size: 0.75rem;
  color: #9ca3af;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.rag-actions {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 1rem;
}

.action-button {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.625rem 1.25rem;
  border-radius: 8px;
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  border: none;
}

.action-button.primary {
  background: linear-gradient(135deg, #8a5cf5 0%, #6366f1 100%);
  color: white;
  box-shadow: 0 2px 8px rgba(138, 92, 245, 0.3);
}

.action-button.primary:hover:not(:disabled) {
  background: linear-gradient(135deg, #a78bfa 0%, #818cf8 100%);
  box-shadow: 0 4px 16px rgba(138, 92, 245, 0.4);
}

.action-button.secondary {
  background: rgba(99, 102, 241, 0.1);
  color: var(--text-primary);
  border: 1px solid rgba(99, 102, 241, 0.3);
}

.action-button.secondary:hover:not(:disabled) {
  background: rgba(99, 102, 241, 0.2);
  border-color: rgba(99, 102, 241, 0.5);
}

.action-button.danger {
  background: rgba(239, 68, 68, 0.1);
  color: #f87171;
  border: 1px solid rgba(239, 68, 68, 0.3);
}

.action-button.danger:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.2);
  border-color: rgba(239, 68, 68, 0.5);
}

.action-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.index-result {
  padding: 1rem;
  border-radius: 8px;
  margin-top: 1rem;
}

.index-result p {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.index-result .mdi {
  font-size: 1.1rem;
}

.index-result.success {
  background: rgba(34, 197, 94, 0.1);
  border: 1px solid rgba(34, 197, 94, 0.3);
  color: #4ade80;
}

.index-result.error {
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  color: #f87171;
}

.error-list {
  margin-top: 0.75rem;
}

.error-list summary {
  cursor: pointer;
  color: var(--text-secondary);
  font-size: 0.85rem;
}

.error-list ul {
  margin-top: 0.5rem;
  padding-left: 1.5rem;
  font-size: 0.8rem;
  color: var(--text-tertiary);
}

.error-list li {
  margin: 0.25rem 0;
  word-break: break-word;
}

/* Scrollbar styling for nebula theme */
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

::-webkit-scrollbar-track {
  background: rgba(12, 13, 29, 0.5);
}

::-webkit-scrollbar-thumb {
  background: rgba(138, 92, 245, 0.4);
  border-radius: 4px;
}

::-webkit-scrollbar-thumb:hover {
  background: rgba(138, 92, 245, 0.6);
}

/* Mobile responsive styles */
@media (max-width: 768px) {
  .main-container {
    flex-direction: column-reverse;
  }

  .tabs-header {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 100;
    justify-content: space-around;
    padding: 0.5rem 0.25rem;
    padding-bottom: calc(0.5rem + env(safe-area-inset-bottom, 0));
    border-bottom: none;
    border-top: 1px solid var(--border-light);
  }

  .app-title {
    display: none;
  }

  .tab-button {
    flex: 1;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.5rem 0.25rem;
    font-size: 0.75rem;
    max-width: 80px;
  }

  .tab-button .mdi {
    font-size: 1.3rem;
  }

  .tab-button .tab-label {
    font-size: 0.65rem;
  }

  .main-content {
    padding-bottom: 70px;
  }

  .tab-content {
    padding: 1rem;
    padding-bottom: 80px;
  }

  .wiki-content {
    padding-bottom: 70px;
  }
}
</style>
