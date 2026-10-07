<template>
  <div id="app">
    <!-- Not behind the fullscreen screen view: nobody sees it there, and the
         TV machine also runs the 3D dice. -->
    <NebulaBackground v-if="!$route.meta.fullscreen" />

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

    <!-- This tab runs an older build than the server's (left open across a
         deploy): what it loads on demand is gone. Reloading brings it back. -->
    <div v-if="stale && !$route.meta.fullscreen" class="app-update" role="status">
      <span class="mdi mdi-update" aria-hidden="true"></span>
      <span class="app-update-text">Realm Keeper was updated. Reload to get everything back.</span>
      <button type="button" class="rk-btn rk-btn--primary rk-btn--sm" @click="reload">Reload</button>
    </div>

    <!-- A failed sign-in comes back to a public page (every route is), where
         the login gate never shows: say what happened there instead. -->
    <div v-if="authError && !showLoginGate && !$route.meta.fullscreen" class="auth-error rk-alert" role="alert">
      <span class="mdi mdi-alert-circle-outline"></span>
      <span class="auth-error-text">{{ authError }}</span>
      <button type="button" class="rk-icon-btn rk-icon-btn--sm auth-error-close" aria-label="Dismiss" @click="authError = ''">
        <span class="mdi mdi-close"></span>
      </button>
    </div>
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
import { useAppUpdate, watchForUpdates } from './composables/useAppUpdate'

// A screen (a TV nobody is sitting at) reloads by itself when it turns out to
// be out of date, at most this often, so a build that is broken for good
// can't keep it reloading.
const SCREEN_RELOAD_GAP_MS = 60_000
const SCREEN_RELOAD_KEY = 'realm-keeper-screen-reloaded-at'

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
    watchForUpdates()
    const { stale, reload } = useAppUpdate()
    return { user, checked, checkAuth, login, stale, reload }
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
  watch: {
    stale(isStale) {
      if (!isStale || !this.$route.meta.fullscreen) return
      let last = 0
      try { last = Number(sessionStorage.getItem(SCREEN_RELOAD_KEY)) || 0 } catch { /* no storage: reload anyway */ }
      if (Date.now() - last < SCREEN_RELOAD_GAP_MS) return
      try { sessionStorage.setItem(SCREEN_RELOAD_KEY, String(Date.now())) } catch { /* as above */ }
      this.reload()
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

.auth-error {
  position: fixed;
  top: var(--space-4);
  left: 50%;
  transform: translateX(-50%);
  z-index: var(--z-toast);
  width: min(calc(100vw - 2 * var(--space-4)), 440px);
  align-items: center;
  /* The alert's red tint over the chrome surface: it floats over the note. */
  background: linear-gradient(var(--status-error-bg), var(--status-error-bg)), var(--surface-chrome);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  box-shadow: var(--shadow-lg);
}

.app-update {
  position: fixed;
  bottom: var(--space-4);
  left: 50%;
  transform: translateX(-50%);
  z-index: var(--z-toast);
  width: min(calc(100vw - 2 * var(--space-4)), 440px);
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  background: var(--surface-chrome);
  border: 1px solid var(--accent-a45);
  border-radius: var(--radius-lg);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  box-shadow: var(--shadow-lg);
  color: var(--text-primary);
  font-size: var(--text-sm);
}

.app-update .mdi {
  font-size: 1.2rem;
  color: var(--accent-soft);
}

.app-update-text {
  flex: 1;
  min-width: 0;
}

.auth-error-text {
  flex: 1;
  min-width: 0;
}

.auth-error-close {
  color: inherit;
}

@media (max-width: 768px) {
  .main-content {
    padding-bottom: calc(var(--mobile-bar-height) + env(safe-area-inset-bottom, 0px));
  }
}
</style>
