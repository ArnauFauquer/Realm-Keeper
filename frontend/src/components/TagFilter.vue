<template>
  <div class="tag-filter-section">
    <button 
      class="tag-filter-toggle"
      :class="{ 'is-active': showTagFilter }"
      @click="showTagFilter = !showTagFilter"
    >
      <span class="mdi mdi-tag-multiple"></span>
      <span>Tags</span>
      <span v-if="selectedTags.length" class="tag-count">{{ selectedTags.length }}</span>
      <span class="mdi" :class="showTagFilter ? 'mdi-chevron-up' : 'mdi-chevron-down'"></span>
    </button>
    
    <div v-if="showTagFilter" class="tag-filter-dropdown">
      <input 
        v-model="tagSearchQuery"
        type="text"
        placeholder="Search tags..."
        class="tag-search-input"
      />
      <div class="tag-list">
        <button
          v-for="tag in filteredAvailableTags"
          :key="tag"
          class="tag-item"
          :class="{ 'is-selected': selectedTags.includes(tag) }"
          @click="toggleTag(tag)"
        >
          <span class="mdi" :class="selectedTags.includes(tag) ? 'mdi-checkbox-marked' : 'mdi-checkbox-blank-outline'"></span>
          {{ tag }}
        </button>
        <div v-if="filteredAvailableTags.length === 0" class="no-tags">
          No tags found
        </div>
      </div>
      <button 
        v-if="selectedTags.length > 0"
        class="clear-tags-btn"
        @click="clearTags"
      >
        <span class="mdi mdi-close-circle"></span>
        Clear filters
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  availableTags: {
    type: Array,
    required: true
  },
  selectedTags: {
    type: Array,
    required: true
  }
})

const emit = defineEmits(['update:selectedTags'])

const showTagFilter = ref(false)
const tagSearchQuery = ref('')

const filteredAvailableTags = computed(() => {
  if (!tagSearchQuery.value) {
    return props.availableTags
  }
  const query = tagSearchQuery.value.toLowerCase()
  return props.availableTags.filter(tag => tag.toLowerCase().includes(query))
})

const toggleTag = (tag) => {
  const newSelectedTags = [...props.selectedTags]
  const index = newSelectedTags.indexOf(tag)
  if (index === -1) {
    newSelectedTags.push(tag)
  } else {
    newSelectedTags.splice(index, 1)
  }
  emit('update:selectedTags', newSelectedTags)
}

const clearTags = () => {
  tagSearchQuery.value = ''
  emit('update:selectedTags', [])
}
</script>

<style scoped>
.tag-filter-section {
  margin-top: 0.75rem;
  position: relative;
}

.tag-filter-toggle {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--border-light);
  border-radius: 8px;
  background: rgba(26, 27, 58, 0.6);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 0.85rem;
  transition: all 0.2s ease;
}

.tag-filter-toggle:hover,
.tag-filter-toggle.is-active {
  border-color: var(--interactive-primary);
  background: rgba(31, 32, 69, 0.8);
  color: var(--text-primary);
}

.tag-filter-toggle .tag-count {
  background: var(--interactive-primary);
  color: white;
  padding: 0.125rem 0.5rem;
  border-radius: 10px;
  font-size: 0.75rem;
  margin-left: auto;
}

.tag-filter-toggle .mdi:last-child {
  margin-left: auto;
}

.tag-filter-dropdown {
  position: absolute;
  top: calc(100% + 0.25rem);
  left: 0;
  right: 0;
  background: rgba(18, 19, 42, 0.98);
  border: 1px solid var(--border-light);
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  z-index: 100;
  max-height: 250px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.tag-search-input {
  width: 100%;
  padding: 0.5rem 0.75rem;
  border: none;
  border-bottom: 1px solid var(--border-light);
  background: transparent;
  color: var(--text-primary);
  font-size: 0.85rem;
}

.tag-search-input:focus {
  outline: none;
  background: rgba(31, 32, 69, 0.4);
}

.tag-search-input::placeholder {
  color: var(--text-tertiary);
}

.tag-list {
  flex: 1;
  overflow-y: auto;
  padding: 0.25rem;
}

.tag-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.4rem 0.6rem;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 0.85rem;
  border-radius: 4px;
  transition: all 0.15s ease;
  text-align: left;
}

.tag-item:hover {
  background: rgba(138, 92, 245, 0.15);
  color: var(--text-primary);
}

.tag-item.is-selected {
  color: var(--interactive-primary);
}

.tag-item .mdi {
  font-size: 1rem;
}

.no-tags {
  padding: 1rem;
  text-align: center;
  color: var(--text-tertiary);
  font-size: 0.85rem;
}

.clear-tags-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.5rem;
  border: none;
  border-top: 1px solid var(--border-light);
  background: rgba(239, 68, 68, 0.1);
  color: var(--status-error);
  cursor: pointer;
  font-size: 0.8rem;
  transition: all 0.15s ease;
}

.clear-tags-btn:hover {
  background: rgba(239, 68, 68, 0.2);
}
</style>
