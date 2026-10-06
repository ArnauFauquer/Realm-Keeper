<template>
  <span class="live-badge" :class="`live-badge--${syncStatus}`" :title="live[1]">
    <span class="mdi mdi-circle-medium"></span>{{ live[0] }}
  </span>
</template>

<script setup>
// Whether changes to a live document reach this page as they are made.
import { computed } from 'vue'
import { syncStatus } from '@/composables/syncSocket'

const LIVE = {
  open: ['Live', 'Changes appear for everyone as they are made'],
  connecting: ['Connecting…', 'Waiting for the connection: changes may be late'],
  denied: ['Signed out', 'Sign in again to see changes live'],
  idle: ['Connecting…', '']
}
const live = computed(() => LIVE[syncStatus.value] || LIVE.idle)
</script>

<style scoped>
.live-badge {
  display: inline-flex;
  align-items: center;
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.live-badge--open {
  color: var(--status-success);
}

.live-badge--connecting,
.live-badge--denied {
  color: var(--status-warning);
}
</style>
