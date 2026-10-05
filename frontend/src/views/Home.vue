<template>
  <div class="home" aria-busy="true">
    <span class="home-mark mdi mdi-saturn" aria-hidden="true"></span>
    <h1 class="home-title">Welcome to Realm Keeper</h1>
    <p class="home-status" role="status">
      <span class="rk-spinner" aria-hidden="true"></span>
      <span>Loading home page...</span>
    </p>
  </div>
</template>
<script>
import { noteRoute } from '@/utils/paths'

export default {
  name: 'Home',
  mounted() {
    const defaultPage = import.meta.env.VITE_DEFAULT_PAGE || 'RealmKeeper'
    this.$router.replace(noteRoute(defaultPage))
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

.home-title {
  font-size: var(--text-xl);
  color: var(--text-primary);
}
</style>