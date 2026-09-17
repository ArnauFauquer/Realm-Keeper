<template>
  <div class="login-gate">
    <div class="login-panel">
      <div class="seal">
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

      <p v-if="error" class="error-msg">
        <span class="mdi mdi-alert-circle-outline"></span>
        {{ error }}
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
  z-index: 3000;
  display: flex;
  align-items: center;
  justify-content: center;
  /* No solid fill on purpose: NebulaBackground's animated starfield sits
     behind this overlay and should still read through it. */
  background: radial-gradient(ellipse at center, rgba(12, 13, 29, 0.45) 0%, rgba(2, 3, 12, 0.82) 100%);
}

.login-panel {
  position: relative;
  background: rgba(18, 19, 42, 0.82);
  backdrop-filter: blur(20px);
  border: 1px solid var(--border-light);
  border-radius: 16px;
  padding: 2.75rem 2.5rem 2.25rem;
  box-shadow:
    0 24px 70px rgba(0, 0, 0, 0.55),
    0 0 90px rgba(138, 43, 226, 0.14);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.4rem;
  width: min(90vw, 360px);
  text-align: center;
  animation: rise 0.5s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes rise {
  from { opacity: 0; transform: translateY(18px); }
  to { opacity: 1; transform: translateY(0); }
}

@media (prefers-reduced-motion: reduce) {
  .login-panel { animation: none; }
}

.seal {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: radial-gradient(circle, rgba(138, 92, 245, 0.28), transparent 72%);
  border: 1px solid var(--border-medium);
}

.seal .mdi {
  font-size: 1.6rem;
  color: var(--interactive-primaryHover);
}

.brand {
  display: flex;
  align-items: center;
  font-size: 1.35rem;
  font-weight: 500;
}

.brand-name {
  font-family: var(--font-display);
  background: linear-gradient(90deg, #22d3ee 0%, #a78bfa 50%, #f472b6 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.tagline {
  color: var(--text-secondary);
  font-size: 0.875rem;
  line-height: 1.5;
  margin: 0;
}

.google-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.65rem;
  width: 100%;
  background: #131314;
  color: #e3e3e3;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 10px;
  padding: 0.625rem 1.25rem;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

.google-btn:hover {
  background: #1e1f20;
  border-color: rgba(255, 255, 255, 0.3);
  transform: translateY(-1px);
}

.google-btn:active {
  transform: translateY(0) scale(0.98);
}

.error-msg {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  color: var(--status-error, #f87171);
  font-size: 0.8rem;
  line-height: 1.4;
  margin: 0;
  background: rgba(248, 113, 113, 0.1);
  border: 1px solid rgba(248, 113, 113, 0.25);
  padding: 0.625rem 0.8rem;
  border-radius: 8px;
}

.error-msg .mdi {
  flex-shrink: 0;
  font-size: 1rem;
}

.fine-print {
  color: var(--text-tertiary);
  font-size: 0.75rem;
  margin: 0;
}
</style>
