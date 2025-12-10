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
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,  // Remove console.logs in production
        passes: 3
      }
    },
    // Code splitting strategy
    rollupOptions: {
      output: {
        manualChunks: {
          'd3': ['d3'],  // Separate d3 chunk
          'vue-vendor': ['vue', 'vue-router']
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
    }
  }
})
