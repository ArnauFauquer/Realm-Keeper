<template>
  <div class="tree-item">
    <div v-if="item.isFolder">
      <!-- Folder with optional linked note -->
      <div 
        v-if="item.folderNote"
        class="folder-with-note"
        :style="{ paddingLeft: (level * 1) + 'rem' }"
      >
        <span 
          class="folder-toggle"
          @click="$emit('toggle', item.path)"
        >
          <span v-if="hasChildren(item)" class="mdi" :class="item.expanded ? 'mdi-chevron-down' : 'mdi-chevron-right'"></span>
          <span v-else class="mdi mdi-circle-small"></span>
        </span>
        <span class="mdi mdi-file-document-outline"></span>
        <router-link 
          :to="'/note/' + encodeURIComponent(item.folderNote.id)"
          class="folder-note-link"
          active-class="active"
          @click="$emit('note-click')"
        >
          {{ item.name }}
        </router-link>
      </div>
      
      <!-- Regular folder without note -->
      <div 
        v-else
        class="folder"
        :style="{ paddingLeft: (level * 1) + 'rem' }"
        @click="$emit('toggle', item.path)"
      >
        <span class="folder-toggle">
          <span v-if="hasChildren(item)" class="mdi" :class="item.expanded ? 'mdi-chevron-down' : 'mdi-chevron-right'"></span>
          <span v-else class="mdi mdi-circle-small"></span>
        </span>
        <span class="mdi" :class="item.expanded ? 'mdi-folder-open' : 'mdi-folder'"></span>
        {{ item.name }}
      </div>
      
      <div v-if="item.expanded">
        <!-- Subcarpetas -->
        <TreeItem 
          v-for="child in item.children" 
          :key="child.path"
          :item="child"
          :level="level + 1"
          @toggle="(path) => $emit('toggle', path)"
          @note-click="$emit('note-click')"
        />
        
        <!-- Notas en esta carpeta -->
        <router-link 
          v-for="note in item.notes" 
          :key="note.id"
          :to="'/note/' + encodeURIComponent(note.id)"
          class="note-link"
          active-class="active"
          :style="{ paddingLeft: ((level + 1) * 1 + 0.5) + 'rem' }"
          @click="$emit('note-click')"
        >
          <span class="mdi mdi-file-document-outline"></span>
          {{ note.title }}
        </router-link>
      </div>
    </div>
    
    <!-- Nota en la raíz -->
    <router-link 
      v-else
      :to="'/note/' + encodeURIComponent(item.id)"
      class="note-link"
      active-class="active"
      :style="{ paddingLeft: (level * 1 + 0.5) + 'rem' }"
      @click="$emit('note-click')"
    >
      <span class="mdi mdi-file-document-outline"></span>
      {{ item.title }}
    </router-link>
  </div>
</template>

<script>
export default {
  name: 'TreeItem',
  emits: ['toggle', 'note-click'],
  props: {
    item: {
      type: Object,
      required: true
    },
    level: {
      type: Number,
      default: 0
    }
  },
  methods: {
    hasChildren(item) {
      return (item.children && item.children.length > 0) || (item.notes && item.notes.length > 0)
    }
  }
}
</script>

<style scoped>
.tree-item {
  margin-bottom: 0.25rem;
}

.folder {
  padding: 0.5rem;
  cursor: pointer;
  font-weight: 600;
  border-radius: 4px;
  transition: background 0.2s;
  color: var(--text-primary);
}

.folder:hover {
  background: rgba(138, 92, 245, 0.1);
}

.folder-with-note {
  display: flex;
  align-items: center;
  padding: 0.5rem 0;
  border-radius: 4px;
}

.folder-with-note:hover {
  background: rgba(138, 92, 245, 0.1);
}

.folder-toggle {
  margin-right: 0.25rem;
  cursor: pointer;
  user-select: none;
  color: var(--text-secondary);
  display: inline-flex;
  align-items: center;
  width: 1.25rem;
}

.folder-toggle .mdi {
  font-size: 1rem;
  transition: transform 0.2s ease;
}

.folder .mdi-folder,
.folder .mdi-folder-open {
  margin-right: 0.5rem;
  color: var(--text-secondary);
  font-size: 1.1rem;
}

.mdi-file-document-outline {
  margin-right: 0.5rem;
  color: var(--text-secondary);
  font-size: 1rem;
}

.folder-note-link {
  flex: 1;
  font-weight: 600;
  color: var(--text-primary);
  text-decoration: none;
  transition: color 0.2s;
}

.folder-note-link:hover {
  color: var(--interactive-primary);
}

.folder-note-link.active {
  color: var(--interactive-primary);
  font-weight: 700;
}

.note-link {
  display: flex;
  align-items: center;
  padding: 0.5rem;
  text-decoration: none;
  color: var(--text-primary);
  border-radius: 4px;
  transition: background 0.2s;
}

.note-link:hover {
  background: rgba(138, 92, 245, 0.1);
}

.note-link.active {
  background: linear-gradient(135deg, rgba(138, 92, 245, 0.35), rgba(99, 102, 241, 0.35));
  color: var(--text-primary);
  box-shadow: 0 0 10px rgba(138, 92, 245, 0.25);
}
</style>
