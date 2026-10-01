import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import '@mdi/font/css/materialdesignicons.css'
import '@fontsource-variable/space-grotesk'
import './styles/tokens.css'
import './styles/base.css'

createApp(App)
  .use(router)
  .mount('#app')
