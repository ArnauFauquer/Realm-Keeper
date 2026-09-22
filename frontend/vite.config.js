import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  build: {
    // Minify configuration
    minify: 'esbuild',
    // Code splitting strategy
    rollupOptions: {
      output: {
        manualChunks: {
          'd3': ['d3'],  // Separate d3 chunk
          'vue-vendor': ['vue', 'vue-router'],
          'three': ['three'],
          'cannon-es': ['cannon-es']
        }
      }
    },
    // CSS optimization
    cssCodeSplit: true,
    // Disable source maps in production
    sourcemap: false
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: process.env.VITE_ALLOWED_HOSTS?.split(',') || true,
    watch: {
      usePolling: true
    },
    // Mirrors the production ingress path routing (see .argocd/ingress.yaml):
    // frontend and backend appear same-origin, so the auth session cookie
    // works in dev without needing SameSite=None/HTTPS gymnastics.
    proxy: {
      '/api': { target: process.env.VITE_BACKEND_PROXY_TARGET || 'http://localhost:8000', changeOrigin: true },
      '/ws': { target: process.env.VITE_BACKEND_PROXY_TARGET || 'http://localhost:8000', ws: true, changeOrigin: true }
    }
  }
})
