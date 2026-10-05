<template>
  <div class="tree-item">
    <template v-if="item.isFolder">
      <button
        type="button"
        class="row folder"
        :style="{ paddingLeft: `calc(${level} * var(--tree-indent) + var(--space-2))` }"
        :aria-expanded="item.expanded"
        @click="$emit('toggle', item.path)"
      >
        <span class="chevron mdi" :class="hasChildren(item) ? 'mdi-chevron-right' : 'mdi-circle-small'" :data-open="item.expanded" aria-hidden="true"></span>
        <span class="row-icon mdi" :class="item.expanded ? 'mdi-folder-open' : 'mdi-folder'" aria-hidden="true"></span>
        <span class="row-label">{{ item.name }}</span>
      </button>

      <div v-if="item.expanded" class="children" :style="{ '--guide-left': `calc(${level} * var(--tree-indent) + var(--space-2) + 9px)` }">
        <TreeItem
          v-for="child in item.children"
          :key="child.path"
          :item="child"
          :level="level + 1"
          @toggle="(path) => $emit('toggle', path)"
          @note-click="$emit('note-click')"
        />

        <router-link
          v-for="note in item.notes"
          :key="note.id"
          :to="noteRoute(note.id)"
          class="row note-link"
          active-class="active"
          :style="{ paddingLeft: `calc(${level + 1} * var(--tree-indent) + var(--space-2) + 20px)` }"
          @click="$emit('note-click')"
        >
          <span class="row-icon mdi mdi-file-document-outline" aria-hidden="true"></span>
          <span class="row-label">{{ note.title }}</span>
        </router-link>
      </div>
    </template>

    <router-link
      v-else
      :to="noteRoute(item.id)"
      class="row note-link"
      active-class="active"
      :style="{ paddingLeft: `calc(${level} * var(--tree-indent) + var(--space-2) + 20px)` }"
      @click="$emit('note-click')"
    >
      <span class="row-icon mdi mdi-file-document-outline" aria-hidden="true"></span>
      <span class="row-label">{{ item.title }}</span>
    </router-link>
  </div>
</template>

<script>
import { noteRoute } from '@/utils/paths'

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
    noteRoute,
    hasChildren(item) {
      return (item.children && item.children.length > 0) || (item.notes && item.notes.length > 0)
    }
  }
}
</script>

<style scoped>
.tree-item {
  --tree-indent: 0.875rem;
}

.row {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  min-height: 32px;
  padding-right: var(--space-2);
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  text-align: left;
  text-decoration: none;
  transition: background-color var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out);
}

.row:hover {
  background: var(--hover-tint);
  color: var(--text-primary);
}

.row-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-icon {
  flex-shrink: 0;
  font-size: 1rem;
  color: var(--text-muted);
}

.folder {
  color: var(--text-primary);
  font-weight: 500;
}

.folder .row-icon {
  color: var(--text-secondary);
}

.chevron {
  flex-shrink: 0;
  width: 18px;
  margin-right: -6px;
  font-size: 1rem;
  color: var(--text-muted);
  transition: transform var(--duration-base) var(--ease-out);
}

.chevron[data-open='true'].mdi-chevron-right {
  transform: rotate(90deg);
}

/* Indent guide so deep folders stay readable. */
.children {
  position: relative;
}

.children::before {
  content: '';
  position: absolute;
  top: 2px;
  bottom: 2px;
  left: var(--guide-left);
  width: 1px;
  background: var(--border-light);
  pointer-events: none;
}

.note-link.active {
  background: var(--accent-a20);
  color: var(--text-primary);
  font-weight: 500;
}

.note-link.active .row-icon {
  color: var(--accent-hover);
}

.note-link.active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 7px;
  bottom: 7px;
  width: 3px;
  border-radius: var(--radius-full);
  background: var(--accent-hover);
}
</style>
