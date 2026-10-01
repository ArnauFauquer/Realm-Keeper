<template>
  <div id="app">
    <NebulaBackground />

    <div v-if="!checked && !$route.meta.public" class="auth-loading">
      <div class="rk-spinner rk-spinner--lg" role="status" aria-label="Checking session"></div>
    </div>

    <LoginGate v-else-if="showLoginGate" :error="authError" @login="login" />

    <template v-else>
      <div class="main-container">
        <NotesSidebar v-if="!$route.meta.fullscreen" ref="notesSidebar" />
        <main class="main-content">
          <router-view />
        </main>
      </div>
      <template v-if="!$route.meta.fullscreen && user">
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
#app {
  display: flex;
  flex-direction: column;
  height: 100dvh;
  overflow: hidden;
  position: relative;
}

.auth-loading {
  position: fixed;
  inset: 0;
  z-index: var(--z-gate);
  display: flex;
  align-items: center;
  justify-content: center;
}

.main-container {
  flex: 1;
  min-height: 0;
  display: flex;
  overflow: hidden;
  position: relative;
  z-index: var(--z-base);
}

.main-content {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  background: var(--surface-app);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  position: relative;
}

.main-content h2 {
  margin-bottom: var(--space-4);
  color: var(--text-primary);
}

.main-content p {
  color: var(--text-secondary);
  font-size: var(--text-md);
  line-height: var(--leading-relaxed);
}

@media (max-width: 768px) {
  .main-content {
    padding-bottom: calc(var(--mobile-bar-height) + env(safe-area-inset-bottom, 0px));
  }
}
</style>
