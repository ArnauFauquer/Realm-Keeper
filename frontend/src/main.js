import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import '@mdi/font/css/materialdesignicons.css'
import '@fontsource-variable/space-grotesk'
import './styles/tokens.css'
import './styles/base.css'

// Production only: the service worker serves JS from cache first, which is
// safe for Vite's content-hashed build output but not for the dev server's
// unhashed /src modules - there it kept serving stale code after edits.
// In dev, also drop a worker a previous production build left registered.
if ('serviceWorker' in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch((error) => {
        console.log('SW registration failed:', error)
      })
    })
  } else {
    navigator.serviceWorker.getRegistrations().then(registrations => {
      registrations.forEach(r => r.unregister())
    })
    window.caches?.keys().then(keys => {
      keys.filter(k => k.startsWith('realm-keeper-')).forEach(k => caches.delete(k))
    })
  }
}

createApp(App)
  .use(router)
  .mount('#app')
