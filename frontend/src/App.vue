<template>
  <div id="app">
    <NebulaBackground />
    <div class="main-container">
      <header class="tabs-header">
        <button 
          v-for="tab in tabs" :key="tab.id"
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
      </header>
      <main class="main-content">
        <div v-if="activeTab === 'notes'" class="notes-container">
          <NotesSidebar ref="notesSidebar" />
          <div class="notes-content"><router-view /></div>
        </div>
        <div v-else class="tab-content full-size"><router-view /></div>
      </main>
    </div>
  </div>
</template>

<script>
import NotesSidebar from './components/NotesSidebar.vue'
import NebulaBackground from './components/NebulaBackground.vue'
import { applyTheme } from './config/theme'

export default {
  name: 'App',
  components: { NotesSidebar, NebulaBackground },
  provide() { return { addTagFilter: this.addTagFilter } },
  data() {
    return {
      activeTab: 'notes',
      tabs: [
        { id: 'notes', label: 'Notes', icon: 'mdi mdi-book-open-page-variant' },
        { id: 'graph', label: 'Graph', icon: 'mdi mdi-graph-outline' }
      ]
    }
  },
  methods: {
    addTagFilter(tag) {
      this.activeTab = 'notes'
      this.$nextTick(() => {
        if (this.$refs.notesSidebar) this.$refs.notesSidebar.addTagToFilter(tag)
      })
    }
  },
  watch: {
    '$route'(to) {
      this.activeTab = to.name === 'Graph' ? 'graph' : 'notes'
    },
    activeTab(newTab) {
      const path = newTab === 'graph' ? '/graph' : '/'
      if (this.$route.path !== path) this.$router.push(path)
    }
  },
  mounted() { applyTheme() }
}
</script>

<style>
:root {
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

.notes-container {
  display: flex;
  height: 100%;
  overflow: hidden;
}

.notes-content {
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

.loading-stats {
  text-align: center;
  padding: 3rem;
  color: var(--text-secondary);
}

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

  .notes-content {
    padding-bottom: 70px;
  }
}
</style>
