<template>
  <div id="app">
    <NebulaBackground />
    <div class="main-container">
      <NotesSidebar v-if="!$route.meta.fullscreen" ref="notesSidebar" />
      <main class="main-content">
        <router-view />
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
  methods: {
    addTagFilter(tag) {
      this.$nextTick(() => {
        if (this.$refs.notesSidebar && this.$refs.notesSidebar.openSearchWithTag) {
          this.$refs.notesSidebar.openSearchWithTag(tag)
        }
      })
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
  flex-direction: row;
  overflow: hidden;
  position: relative;
  z-index: 1;
}

.main-content {
  flex: 1;
  overflow-y: auto;
  background: rgba(12, 13, 29, 0.7);
  backdrop-filter: blur(8px);
  position: relative;
}

/* Base styles for router-view content previously in tab-content/notes-content */
.main-content h2 {
  margin-bottom: 1rem;
  color: var(--text-primary);
  font-weight: 600;
}

.main-content p {
  color: var(--text-secondary);
  font-size: 1rem;
  line-height: 1.6;
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
    flex-direction: row; /* Keep row, since sidebar goes off-canvas */
  }

  .main-content {
    /* Extra padding at bottom for any floating things, though toggle button takes space */
    padding-bottom: 70px;
  }
}
</style>
