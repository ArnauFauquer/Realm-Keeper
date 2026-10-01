<template>
  <div class="login-gate">
    <div class="login-panel">
      <div class="seal" aria-hidden="true">
        <span class="mdi mdi-shield-lock-outline"></span>
      </div>

      <div class="brand">
        <span class="brand-name">RealmKeeper</span>
      </div>

      <p class="tagline">This vault is sealed. Sign in to continue your campaign.</p>

      <button class="google-btn" @click="$emit('login')">
        <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true">
          <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"/>
          <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"/>
          <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"/>
          <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"/>
        </svg>
        <span>Sign in with Google</span>
      </button>

      <p v-if="error" class="rk-alert" role="alert">
        <span class="mdi mdi-alert-circle-outline"></span>
        <span>{{ error }}</span>
      </p>

      <p class="fine-print">Access is limited to invited players.</p>
    </div>
  </div>
</template>

<script setup>
defineProps({
  error: { type: String, default: '' }
})
defineEmits(['login'])
</script>

<style scoped>
.login-gate {
  position: fixed;
  inset: 0;
  z-index: var(--z-gate);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-4);
  /* No solid fill on purpose: NebulaBackground's animated starfield sits
     behind this overlay and should still read through it. */
  background: radial-gradient(ellipse at center, rgba(12, 13, 29, 0.45) 0%, rgba(2, 3, 12, 0.82) 100%);
}

.login-panel {
  position: relative;
  width: min(100%, 360px);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-5);
  padding: var(--space-10) var(--space-8) var(--space-8);
  text-align: center;
  background: rgba(18, 19, 42, 0.82);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-lg), 0 0 90px rgba(138, 43, 226, 0.14), inset 0 1px 0 rgba(255, 255, 255, 0.04);
  animation: rk-rise 0.5s var(--ease-out);
}

.seal {
  width: 52px;
  height: 52px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-full);
  background: radial-gradient(circle, rgba(138, 92, 245, 0.28), transparent 72%);
  border: 1px solid var(--border-medium);
}

.seal .mdi {
  font-size: 1.6rem;
  color: var(--accent-hover);
}

.brand {
  display: flex;
  align-items: center;
  margin-top: calc(-1 * var(--space-2));
  font-size: 1.6rem;
  font-weight: 600;
  letter-spacing: -0.015em;
}

.brand-name {
  font-family: var(--font-display);
  background: var(--brand-gradient);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}

.tagline {
  max-width: 30ch;
  margin: calc(-1 * var(--space-2)) 0 0;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
}

/* Google's own dark sign-in button spec: keep its colours, not ours. */
.google-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.65rem;
  width: 100%;
  min-height: var(--control-lg);
  padding: 0 var(--space-5);
  background: #131314;
  color: #e3e3e3;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  font-weight: 500;
  transition:
    background-color var(--duration-base) var(--ease-out),
    border-color var(--duration-base) var(--ease-out),
    transform var(--duration-fast) var(--ease-out);
}

.google-btn:hover {
  background: #1e1f20;
  border-color: rgba(255, 255, 255, 0.3);
  transform: translateY(-1px);
}

.google-btn:active {
  transform: translateY(0) scale(0.98);
}

.rk-alert {
  width: 100%;
  margin: 0;
  text-align: left;
}

.fine-print {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-xs);
}
</style>