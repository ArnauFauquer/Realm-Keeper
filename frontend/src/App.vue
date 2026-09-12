<template>
  <div id="app">
    <NebulaBackground />

    <div v-if="!checked && !$route.meta.public" class="auth-loading">
      <div class="auth-loading-spinner"></div>
    </div>

    <LoginGate v-else-if="showLoginGate" :error="authError" @login="login" />

    <template v-else>
      <div class="main-container">
        <NotesSidebar v-if="!$route.meta.fullscreen" ref="notesSidebar" />
        <main class="main-content">
          <router-view />
        </main>
      </div>
      <template v-if="!$route.meta.fullscreen">
        <DiceFab />
        <DicePanel />
        <DiceToastStack />
      </template>
    </template>

    <DiceOverlay />
  </div>
</template>

<script>
import NotesSidebar from './components/NotesSidebar.vue'
import NebulaBackground from './components/NebulaBackground.vue'
import DiceFab from './components/DiceFab.vue'
import DicePanel from './components/DicePanel.vue'
import DiceOverlay from './components/DiceOverlay.vue'
import DiceToastStack from './components/DiceToastStack.vue'
import LoginGate from './components/LoginGate.vue'
import { applyTheme } from './config/theme'
import { useAuth } from './composables/useAuth'

const AUTH_ERROR_MESSAGES = {
  not_allowed: "This Google account isn't authorized for this vault.",
  login_failed: 'Sign-in failed. Please try again.'
}

export default {
  name: 'App',
  components: { NotesSidebar, NebulaBackground, DiceFab, DicePanel, DiceOverlay, DiceToastStack, LoginGate },
  provide() { return { addTagFilter: this.addTagFilter } },
  setup() {
    const { user, checked, checkAuth, login } = useAuth()
    return { user, checked, checkAuth, login }
  },
  data() {
    return {
      authError: ''
    }
  },
  computed: {
    showLoginGate() {
      return !this.$route.meta.public && !this.user
    }
  },
  methods: {
    addTagFilter(tag) {
      this.$nextTick(() => {
        if (this.$refs.notesSidebar && this.$refs.notesSidebar.openSearchWithTag) {
          this.$refs.notesSidebar.openSearchWithTag(tag)
        }
      })
    }
  },
  mounted() {
    applyTheme()

    const params = new URLSearchParams(window.location.search)
    const authErrorCode = params.get('auth_error')
    if (authErrorCode) {
      this.authError = AUTH_ERROR_MESSAGES[authErrorCode] || 'Sign-in failed. Please try again.'
      params.delete('auth_error')
      const query = params.toString()
      window.history.replaceState(null, '', window.location.pathname + (query ? `?${query}` : ''))
    }

    this.checkAuth()
  }
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

.auth-loading {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.auth-loading-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid rgba(138, 92, 245, 0.2);
  border-top-color: var(--interactive-primary);
  border-radius: 50%;
  animation: auth-spin 0.9s linear infinite;
  box-shadow: 0 0 16px rgba(138, 92, 245, 0.2);
}

@keyframes auth-spin {
  to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
  .auth-loading-spinner { animation-duration: 1.8s; }
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
