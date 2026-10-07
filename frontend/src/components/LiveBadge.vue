<template>
  <span v-if="shown" class="live-badge" :class="`live-badge--${syncStatus}`" :title="live[1]" role="status">
    <span class="mdi" :class="live[2]"></span>{{ live[0] }}
  </span>
</template>

<script setup>
// Says when changes to a live document stop reaching this page as they are
// made, and nothing while they do: a "Live" that is always there says
// nothing. A connection being made is only mentioned once it takes a while
// (opening a document connects too, in a moment).
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { syncStatus } from '@/composables/syncSocket'

const SLOW_CONNECTION_MS = 2000

const LIVE = {
  connecting: ['Reconnecting…', 'Waiting for the connection: changes may be late', 'mdi-wifi-strength-alert-outline'],
  denied: ['Signed out', 'Sign in again to see changes live', 'mdi-account-alert-outline']
}
const live = computed(() => LIVE[syncStatus.value] || LIVE.connecting)

const slow = ref(false)
let timer = null
watch(syncStatus, (status) => {
  clearTimeout(timer)
  slow.value = false
  if (status === 'connecting') timer = setTimeout(() => { slow.value = true }, SLOW_CONNECTION_MS)
}, { immediate: true })
onBeforeUnmount(() => clearTimeout(timer))

const shown = computed(() => syncStatus.value === 'denied' || (syncStatus.value === 'connecting' && slow.value))
</script>

<style scoped>
.live-badge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.live-badge--connecting,
.live-badge--denied {
  color: var(--status-warning);
}
</style>
