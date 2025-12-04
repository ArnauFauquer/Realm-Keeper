<template>
  <div class="chat-container">
    <!-- Chat Header -->
    <div class="chat-header">
      <div class="header-info">
        <span class="header-icon">🧠</span>
        <div class="header-text">
          <h2>Realm Knowledge</h2>
          <span class="header-subtitle">Ask questions about your vault</span>
        </div>
      </div>
      <div class="header-controls">
        <select v-model="queryMode" class="mode-select" title="Query Mode">
          <option value="hybrid">🔀 Hybrid</option>
          <option value="local">📍 Local</option>
          <option value="global">🌐 Global</option>
          <option value="naive">📝 Naive</option>
          <option value="mix">🎯 Mix</option>
        </select>
        <button @click="clearChat" class="clear-button" title="Clear Chat">
          <span class="mdi mdi-delete-outline"></span>
        </button>
      </div>
    </div>

    <!-- Messages Container -->
    <div class="messages-container" ref="messagesContainer">
      <!-- Welcome message when empty -->
      <div v-if="messages.length === 0" class="welcome-message">
        <div class="welcome-icon">✨</div>
        <h3>Welcome to Realm Knowledge</h3>
        <p>Ask me anything about your vault's content. I have knowledge of all your notes, characters, locations, and lore.</p>
        <div class="suggestion-chips">
          <button 
            v-for="suggestion in suggestions" 
            :key="suggestion"
            @click="sendMessage(suggestion)"
            class="suggestion-chip"
          >
            {{ suggestion }}
          </button>
        </div>
      </div>

      <!-- Chat Messages -->
      <div 
        v-for="(message, index) in messages" 
        :key="index"
        :class="['message', message.role]"
      >
        <div class="message-avatar">
          {{ message.role === 'user' ? '👤' : '🧠' }}
        </div>
        <div class="message-content">
          <div class="message-header">
            <span class="message-role">{{ message.role === 'user' ? 'You' : 'Realm Keeper' }}</span>
            <span class="message-time">{{ formatTime(message.timestamp) }}</span>
          </div>
          <div class="message-text" v-html="formatMessage(message.content)"></div>
        </div>
      </div>

      <!-- Loading indicator -->
      <div v-if="isLoading" class="message assistant loading">
        <div class="message-avatar">🧠</div>
        <div class="message-content">
          <div class="typing-indicator">
            <span></span>
            <span></span>
            <span></span>
          </div>
        </div>
      </div>
    </div>

    <!-- Input Area -->
    <div class="input-container">
      <div class="input-wrapper">
        <textarea 
          v-model="inputMessage"
          @keydown.enter.exact.prevent="sendMessage()"
          @keydown.shift.enter="newLine"
          placeholder="Ask about your realm..."
          :disabled="isLoading"
          ref="inputField"
          rows="1"
        ></textarea>
        <button 
          @click="sendMessage()" 
          :disabled="!inputMessage.trim() || isLoading"
          class="send-button"
        >
          <span v-if="isLoading" class="mdi mdi-loading mdi-spin"></span>
          <span v-else class="mdi mdi-send"></span>
        </button>
      </div>
      <div class="input-hint">
        Press <kbd>Enter</kbd> to send, <kbd>Shift + Enter</kbd> for new line
      </div>
    </div>

    <!-- Error Toast -->
    <div v-if="error" class="error-toast" @click="error = null">
      <span class="mdi mdi-alert-circle"></span>
      {{ error }}
    </div>
  </div>
</template>

<script>
import axios from 'axios'
import MarkdownIt from 'markdown-it'

const md = new MarkdownIt({
  html: false,
  breaks: true,
  linkify: true
})

export default {
  name: 'ChatView',
  props: {
    apiUrl: {
      type: String,
      required: true
    }
  },
  data() {
    return {
      messages: [],
      inputMessage: '',
      isLoading: false,
      error: null,
      queryMode: 'hybrid',
      suggestions: [
        'Who are the main characters?',
        'What factions exist in the world?',
        'Tell me about recent events',
        'What locations are important?'
      ]
    }
  },
  methods: {
    async sendMessage(text = null) {
      const messageText = text || this.inputMessage.trim()
      if (!messageText) return

      // Add user message
      const userMessage = {
        role: 'user',
        content: messageText,
        timestamp: new Date()
      }
      this.messages.push(userMessage)
      this.inputMessage = ''
      this.isLoading = true
      this.error = null

      // Auto-scroll to bottom
      this.$nextTick(() => this.scrollToBottom())

      try {
        // Build conversation history (last 10 messages for context)
        const history = this.messages.slice(-11, -1).map(m => ({
          role: m.role,
          content: m.content
        }))

        const response = await axios.post(`${this.apiUrl}/api/chat/query`, {
          message: messageText,
          mode: this.queryMode,
          stream: false,
          conversation_history: history.length > 0 ? history : null
        })

        // Add assistant response
        this.messages.push({
          role: 'assistant',
          content: response.data.response,
          timestamp: new Date(),
          mode: response.data.mode
        })
      } catch (err) {
        console.error('Chat error:', err)
        this.error = err.response?.data?.detail || err.message || 'Failed to get response'
        // Remove the user message if there was an error
        // this.messages.pop()
      } finally {
        this.isLoading = false
        this.$nextTick(() => {
          this.scrollToBottom()
          this.$refs.inputField?.focus()
        })
      }
    },
    clearChat() {
      if (this.messages.length > 0 && confirm('Clear all chat history?')) {
        this.messages = []
      }
    },
    scrollToBottom() {
      const container = this.$refs.messagesContainer
      if (container) {
        container.scrollTop = container.scrollHeight
      }
    },
    formatTime(date) {
      if (!date) return ''
      return new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    },
    formatMessage(content) {
      // Use markdown-it to render markdown
      return md.render(content || '')
    },
    newLine() {
      // Shift+Enter adds newline - handled naturally by textarea
    },
    autoResizeTextarea() {
      const textarea = this.$refs.inputField
      if (textarea) {
        textarea.style.height = 'auto'
        textarea.style.height = Math.min(textarea.scrollHeight, 150) + 'px'
      }
    }
  },
  watch: {
    inputMessage() {
      this.$nextTick(() => this.autoResizeTextarea())
    }
  },
  mounted() {
    this.$refs.inputField?.focus()
  }
}
</script>

<style scoped>
.chat-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  max-height: 100%;
  background: rgba(12, 13, 29, 0.6);
  border-radius: 12px;
  overflow: hidden;
}

/* Header */
.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.5rem;
  background: rgba(18, 19, 42, 0.8);
  border-bottom: 1px solid var(--border-light);
}

.header-info {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.header-icon {
  font-size: 1.75rem;
}

.header-text h2 {
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.header-subtitle {
  font-size: 0.8rem;
  color: var(--text-tertiary);
}

.header-controls {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.mode-select {
  background: var(--bg-tertiary);
  border: 1px solid var(--border-light);
  color: var(--text-primary);
  padding: 0.4rem 0.75rem;
  border-radius: 6px;
  font-size: 0.85rem;
  cursor: pointer;
  outline: none;
}

.mode-select:hover {
  border-color: var(--border-medium);
}

.clear-button {
  background: transparent;
  border: 1px solid var(--border-light);
  color: var(--text-secondary);
  padding: 0.4rem 0.6rem;
  border-radius: 6px;
  cursor: pointer;
  font-size: 1.1rem;
  display: flex;
  align-items: center;
}

.clear-button:hover {
  background: rgba(255, 100, 100, 0.1);
  border-color: rgba(255, 100, 100, 0.3);
  color: #ff6b6b;
}

/* Messages */
.messages-container {
  flex: 1;
  overflow-y: auto;
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

/* Welcome Message */
.welcome-message {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 3rem 2rem;
  margin: auto;
}

.welcome-icon {
  font-size: 3rem;
  margin-bottom: 1rem;
}

.welcome-message h3 {
  font-size: 1.4rem;
  color: var(--text-primary);
  margin-bottom: 0.5rem;
}

.welcome-message p {
  color: var(--text-secondary);
  max-width: 400px;
  line-height: 1.5;
  margin-bottom: 1.5rem;
}

.suggestion-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  justify-content: center;
}

.suggestion-chip {
  background: var(--bg-tertiary);
  border: 1px solid var(--border-light);
  color: var(--text-secondary);
  padding: 0.5rem 1rem;
  border-radius: 20px;
  font-size: 0.85rem;
  cursor: pointer;
  transition: all 0.2s;
}

.suggestion-chip:hover {
  background: var(--interactive-secondary);
  border-color: var(--interactive-primary);
  color: var(--text-primary);
}

/* Message Bubbles */
.message {
  display: flex;
  gap: 0.75rem;
  max-width: 85%;
  animation: fadeIn 0.3s ease;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.message.user {
  align-self: flex-end;
  flex-direction: row-reverse;
}

.message.assistant {
  align-self: flex-start;
}

.message-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--bg-tertiary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.1rem;
  flex-shrink: 0;
}

.message.user .message-avatar {
  background: var(--interactive-primary);
}

.message-content {
  background: var(--bg-tertiary);
  border-radius: 12px;
  padding: 0.75rem 1rem;
  border: 1px solid var(--border-light);
}

.message.user .message-content {
  background: linear-gradient(135deg, var(--interactive-primary), #6366f1);
  border-color: transparent;
}

.message-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.25rem;
}

.message-role {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-secondary);
}

.message.user .message-role {
  color: rgba(255, 255, 255, 0.8);
}

.message-time {
  font-size: 0.7rem;
  color: var(--text-tertiary);
}

.message.user .message-time {
  color: rgba(255, 255, 255, 0.6);
}

.message-text {
  color: var(--text-primary);
  line-height: 1.5;
  font-size: 0.95rem;
}

.message.user .message-text {
  color: white;
}

.message-text :deep(p) {
  margin: 0 0 0.5rem 0;
}

.message-text :deep(p:last-child) {
  margin-bottom: 0;
}

.message-text :deep(ul),
.message-text :deep(ol) {
  margin: 0.5rem 0;
  padding-left: 1.5rem;
}

.message-text :deep(code) {
  background: rgba(0, 0, 0, 0.3);
  padding: 0.1rem 0.3rem;
  border-radius: 4px;
  font-size: 0.85em;
}

.message-text :deep(pre) {
  background: rgba(0, 0, 0, 0.3);
  padding: 0.75rem;
  border-radius: 6px;
  overflow-x: auto;
  margin: 0.5rem 0;
}

.message-text :deep(pre code) {
  background: none;
  padding: 0;
}

/* Loading Indicator */
.message.loading .message-content {
  padding: 1rem;
}

.typing-indicator {
  display: flex;
  gap: 4px;
}

.typing-indicator span {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-tertiary);
  animation: typing 1.4s infinite;
}

.typing-indicator span:nth-child(2) {
  animation-delay: 0.2s;
}

.typing-indicator span:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes typing {
  0%, 60%, 100% {
    transform: translateY(0);
    opacity: 0.4;
  }
  30% {
    transform: translateY(-8px);
    opacity: 1;
  }
}

/* Input Area */
.input-container {
  padding: 1rem 1.5rem;
  background: rgba(18, 19, 42, 0.8);
  border-top: 1px solid var(--border-light);
}

.input-wrapper {
  display: flex;
  align-items: flex-end;
  gap: 0.75rem;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-light);
  border-radius: 12px;
  padding: 0.5rem;
  transition: border-color 0.2s;
}

.input-wrapper:focus-within {
  border-color: var(--interactive-primary);
}

.input-wrapper textarea {
  flex: 1;
  background: transparent;
  border: none;
  color: var(--text-primary);
  font-size: 0.95rem;
  padding: 0.5rem;
  resize: none;
  outline: none;
  font-family: inherit;
  line-height: 1.5;
  max-height: 150px;
}

.input-wrapper textarea::placeholder {
  color: var(--text-tertiary);
}

.send-button {
  width: 40px;
  height: 40px;
  border-radius: 8px;
  background: var(--interactive-primary);
  border: none;
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.2rem;
  transition: all 0.2s;
  flex-shrink: 0;
}

.send-button:hover:not(:disabled) {
  background: var(--interactive-primaryHover);
  transform: scale(1.05);
}

.send-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.input-hint {
  font-size: 0.75rem;
  color: var(--text-tertiary);
  text-align: center;
  margin-top: 0.5rem;
}

.input-hint kbd {
  background: var(--bg-tertiary);
  padding: 0.1rem 0.4rem;
  border-radius: 4px;
  font-family: inherit;
  font-size: 0.7rem;
}

/* Error Toast */
.error-toast {
  position: absolute;
  bottom: 100px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(220, 53, 69, 0.95);
  color: white;
  padding: 0.75rem 1.5rem;
  border-radius: 8px;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
  animation: slideUp 0.3s ease;
  z-index: 100;
}

@keyframes slideUp {
  from {
    opacity: 0;
    transform: translateX(-50%) translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }
}

/* Scrollbar */
.messages-container::-webkit-scrollbar {
  width: 6px;
}

.messages-container::-webkit-scrollbar-track {
  background: transparent;
}

.messages-container::-webkit-scrollbar-thumb {
  background: var(--border-medium);
  border-radius: 3px;
}

.messages-container::-webkit-scrollbar-thumb:hover {
  background: var(--interactive-primary);
}
</style>
