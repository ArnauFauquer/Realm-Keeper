<template>
  <div>
    <div v-if="error" class="error-boundary">
      <div class="error-content">
        <div class="error-header">
          <span class="error-icon">⚠️</span>
          <h2>Oops! Something went wrong</h2>
        </div>
        
        <p class="error-message">{{ error.message }}</p>
        
        <div class="error-actions">
          <button @click="reset" class="reset-btn">
            <span class="mdi mdi-restart"></span>
            Try Again
          </button>
          <button @click="toggleDetails" class="details-btn">
            <span class="mdi" :class="showDetails ? 'mdi-chevron-up' : 'mdi-chevron-down'"></span>
            {{ showDetails ? 'Hide' : 'Show' }} Details
          </button>
        </div>

        <details v-if="showDetails" class="error-details">
          <summary>Error Stack Trace</summary>
          <pre class="error-stack">{{ error.stack }}</pre>
        </details>

        <div v-if="showDetails" class="error-info">
          <p><strong>Component:</strong> {{ componentName }}</p>
          <p><strong>Context:</strong> {{ errorContext }}</p>
        </div>
      </div>

      <div class="error-background"></div>
    </div>
    
    <div v-else>
      <slot></slot>
    </div>
  </div>
</template>

<script>
export default {
  name: 'ErrorBoundary',
  data() {
    return {
      error: null,
      showDetails: false,
      componentName: '',
      errorContext: ''
    }
  },
  methods: {
    reset() {
      this.error = null
      this.showDetails = false
      this.componentName = ''
      this.errorContext = ''
      // Optionally reload the page
      // window.location.reload()
    },
    toggleDetails() {
      this.showDetails = !this.showDetails
    }
  },
  errorCaptured(err, instance, info) {
    // Capture error details
    this.error = err
    this.componentName = instance?.$options?.name || 'Unknown Component'
    this.errorContext = info || 'Unknown context'
    
    // Log error for debugging
    console.error('Error caught by ErrorBoundary:', {
      error: err,
      component: this.componentName,
      context: this.errorContext,
      info: info,
      timestamp: new Date().toISOString()
    })
    
    // Prevent error propagation to parent
    return false
  }
}
</script>

<style scoped>
.error-boundary {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.error-background {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(4px);
  z-index: -1;
}

.error-content {
  position: relative;
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
  border: 2px solid #ff4444;
  border-radius: 12px;
  padding: 2.5rem;
  max-width: 600px;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 20px 60px rgba(255, 68, 68, 0.3);
  animation: slideIn 0.3s ease-out;
}

@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateY(-20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.error-header {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.error-icon {
  font-size: 2rem;
}

.error-header h2 {
  margin: 0;
  color: #ff4444;
  font-size: 1.5rem;
  font-weight: 600;
}

.error-message {
  color: #e0e0e0;
  font-size: 0.95rem;
  line-height: 1.6;
  margin: 1rem 0 1.5rem 0;
  padding: 1rem;
  background: rgba(255, 68, 68, 0.1);
  border-left: 3px solid #ff4444;
  border-radius: 4px;
}

.error-actions {
  display: flex;
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.reset-btn,
.details-btn {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1.25rem;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.9rem;
  font-weight: 500;
  transition: all 0.3s ease;
}

.reset-btn {
  background: #ff4444;
  color: white;
  flex: 1;
}

.reset-btn:hover {
  background: #ff2222;
  transform: translateY(-2px);
  box-shadow: 0 8px 16px rgba(255, 68, 68, 0.4);
}

.details-btn {
  background: rgba(255, 68, 68, 0.2);
  color: #ff4444;
  border: 1px solid #ff4444;
}

.details-btn:hover {
  background: rgba(255, 68, 68, 0.3);
}

.error-details {
  margin: 1.5rem 0 1rem 0;
  cursor: pointer;
}

.error-details summary {
  color: #ff4444;
  padding: 0.75rem;
  border-radius: 4px;
  user-select: none;
  transition: background 0.3s ease;
}

.error-details summary:hover {
  background: rgba(255, 68, 68, 0.1);
}

.error-stack {
  background: #0a0a0a;
  padding: 1rem;
  border-radius: 4px;
  overflow-x: auto;
  font-size: 0.75rem;
  line-height: 1.4;
  color: #00ff00;
  margin-top: 0.5rem;
  border: 1px solid #333;
}

.error-info {
  margin-top: 1.5rem;
  padding: 1rem;
  background: rgba(100, 100, 200, 0.1);
  border-radius: 4px;
  font-size: 0.85rem;
}

.error-info p {
  margin: 0.5rem 0;
  color: #b0b0d0;
}

.error-info strong {
  color: #d0d0ff;
}

/* Scrollbar styling for error content */
.error-content::-webkit-scrollbar {
  width: 8px;
}

.error-content::-webkit-scrollbar-track {
  background: rgba(255, 68, 68, 0.1);
  border-radius: 4px;
}

.error-content::-webkit-scrollbar-thumb {
  background: #ff4444;
  border-radius: 4px;
}

.error-content::-webkit-scrollbar-thumb:hover {
  background: #ff6666;
}
</style>
