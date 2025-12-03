<template>
  <div class="home">
    <div class="welcome">
      <h1>🏰 Bienvenido a Realm Keeper</h1>
      <p>Cargando página de inicio...</p>
    </div>
  </div>
</template>

<script>
export default {
  name: 'Home',
  mounted() {
    // Redirect to default welcome page
    const defaultPage = import.meta.env.VITE_DEFAULT_PAGE || 'RealmKeeper'
    this.$router.replace(`/note/${defaultPage}`)
  }
}
</script>

<style scoped>
.home {
  padding: 2rem;
}

.welcome {
  max-width: 600px;
  margin: 0 auto;
  text-align: center;
}

.welcome h1 {
  margin-bottom: 1rem;
  color: var(--text-primary);
}
</style>
