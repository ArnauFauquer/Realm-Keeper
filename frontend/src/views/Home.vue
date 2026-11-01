<template>
  <div class="home" :aria-busy="!empty">
    <span class="home-mark mdi mdi-saturn" aria-hidden="true"></span>
    <h1 class="home-title">Welcome to Realm Keeper</h1>
    <p v-if="empty" class="home-empty">
      The vault has no notes yet. Add Markdown files to its folder (an Obsidian
      vault works as it is) and they show up here.
    </p>
    <p v-else class="home-status" role="status">
      <span class="rk-spinner" aria-hidden="true"></span>
      <span>Loading home page...</span>
    </p>
  </div>
</template>
<script>
import { httpClient } from '@/api/http'
import { apiUrl } from '@/config/env'
import { noteRoute } from '@/utils/paths'

export default {
  name: 'Home',
  data() {
    return { empty: false }
  },
  async mounted() {
    // A build can still fix it (VITE_DEFAULT_PAGE); otherwise the backend
    // knows the vault: HOME_NOTE, or the note it found to open on.
    let page = import.meta.env.VITE_DEFAULT_PAGE
    if (!page) {
      try {
        page = (await httpClient.get(`${apiUrl}/api/home`)).data.note
      } catch (e) {
        page = 'RealmKeeper'   // an older backend, or offline
      }
    }
    if (page) this.$router.replace(noteRoute(page))
    else this.empty = true
  }
}
</script>

<style scoped>
.home {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-4);
  padding: var(--space-8) var(--space-4);
  text-align: center;
}

.home-mark {
  font-size: 2.5rem;
  line-height: 1;
  color: var(--accent);
}

.home-status {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-sm);
}

.home-empty {
  max-width: 44ch;
  margin: 0;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
}

.home-title {
  font-size: var(--text-xl);
  color: var(--text-primary);
}
</style>
