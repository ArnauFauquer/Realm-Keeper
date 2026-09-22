<template>
  <div v-if="isOpen" class="modal-overlay" @click.self="closeModal">
    <div class="modal-content player-modal-content">
      <div class="modal-header">
        <h2><span class="mdi mdi-music-box-multiple-outline"></span> Player</h2>
        <button class="close-btn" @click="closeModal">
          <span class="mdi mdi-close"></span>
        </button>
      </div>

      <div class="modal-body player-body">
        <aside class="album-list">
          <div class="album-list-header">
            <h3>Albums</h3>
            <button class="icon-btn" title="New album" @click="startNewAlbum">
              <span class="mdi mdi-folder-plus-outline"></span>
            </button>
          </div>

          <div v-if="showNewAlbumInput" class="new-album-form">
            <input
              ref="newAlbumInputRef"
              v-model="newAlbumName"
              placeholder="Album name"
              @keyup.enter="submitNewAlbum"
              @keyup.esc="showNewAlbumInput = false"
            />
            <button class="icon-btn" @click="submitNewAlbum"><span class="mdi mdi-check"></span></button>
            <button class="icon-btn" @click="showNewAlbumInput = false"><span class="mdi mdi-close"></span></button>
          </div>

          <div v-if="loadingAlbums" class="hint-state">Loading…</div>
          <div v-else-if="error && !albums.length" class="hint-state error">{{ error }}</div>
          <ul v-else ref="albumListRef" class="album-items">
            <li
              v-for="album in albums"
              :key="album"
              class="album-item"
              :class="{ active: album === currentAlbum, 'drag-over': dragOverTarget === album }"
              @click="renamingAlbum !== album && selectAlbum(album)"
              @mouseleave="pendingDeleteAlbum = null"
              @dragover.prevent="dragOver(album)"
              @dragleave="dragLeave(album)"
              @drop.prevent="drop(album, onMove)"
            >
              <span class="mdi mdi-folder-music-outline"></span>
              <input
                v-if="renamingAlbum === album"
                v-model="renameValue"
                class="album-rename-input"
                @click.stop
                @keyup.enter="submitRenameAlbum(album)"
                @keyup.esc="renamingAlbum = null"
                @blur="submitRenameAlbum(album)"
              />
              <span v-else class="album-name">{{ album }}</span>
              <button
                v-if="renamingAlbum !== album"
                class="icon-btn album-hover-btn"
                :class="{ 'force-visible': pendingDeleteAlbum === album }"
                title="Rename album"
                @click.stop="startRenameAlbum(album)"
              >
                <span class="mdi mdi-pencil-outline"></span>
              </button>
              <button
                class="icon-btn danger album-hover-btn"
                :class="{ 'force-visible': pendingDeleteAlbum === album }"
                :title="pendingDeleteAlbum === album ? 'Confirm delete' : 'Delete album'"
                @click.stop="confirmDeleteAlbum(album)"
              >
                <span class="mdi" :class="pendingDeleteAlbum === album ? 'mdi-check-circle' : 'mdi-trash-can-outline'"></span>
              </button>
            </li>
            <li v-if="!albums.length" class="empty-hint">No albums yet.</li>
          </ul>
        </aside>

        <section class="track-panel">
          <div v-if="!currentAlbum" class="empty-state">
            <span class="mdi mdi-music-note-outline"></span>
            <p>Select or create an album to see its tracks.</p>
          </div>
          <template v-else>
            <div class="track-panel-header">
              <h3>{{ currentAlbum }}</h3>
              <label class="upload-btn">
                <span class="mdi mdi-upload"></span> Upload audio
                <input type="file" accept="audio/*" multiple hidden @change="onFilesSelected" />
              </label>
            </div>

            <div v-if="uploading.length" class="upload-progress-list">
              <div v-for="u in uploading" :key="u.id" class="upload-progress-item">
                <span class="upload-name">{{ u.name }}</span>
                <div class="progress-track"><div class="progress-fill" :style="{ width: (u.progress * 100) + '%' }"></div></div>
              </div>
            </div>

            <div v-if="loadingTracks" class="hint-state">Loading tracks…</div>
            <div v-else-if="error" class="hint-state error">{{ error }}</div>
            <ul v-else ref="trackListRef" class="track-items">
              <li
                v-for="(track, idx) in tracks"
                :key="track.key"
                class="track-item"
                :class="{ active: idx === currentTrackIndex }"
                draggable="true"
                @dblclick="renamingTrack !== track.key && playTrackAt(idx)"
                @dragstart="startDrag(track)"
                @dragend="endDrag"
              >
                <button class="track-play-btn" @click="playTrackAt(idx)">
                  <span class="mdi" :class="idx === currentTrackIndex && isPlaying ? 'mdi-volume-high' : 'mdi-play'"></span>
                </button>
                <input
                  v-if="renamingTrack === track.key"
                  v-model="trackRenameValue"
                  class="track-rename-input"
                  @click.stop
                  @keyup.enter="submitRenameTrack(track)"
                  @keyup.esc="renamingTrack = null"
                  @blur="submitRenameTrack(track)"
                />
                <span v-else class="track-name">{{ track.name }}</span>
                <span class="track-size">{{ formatSize(track.size) }}</span>
                <button
                  v-if="renamingTrack !== track.key"
                  class="icon-btn"
                  :title="copiedTrack === track.key ? 'Copied!' : 'Copy track reference'"
                  @click="copyTrackKey(track)"
                >
                  <span class="mdi" :class="copiedTrack === track.key ? 'mdi-check' : 'mdi-content-copy'"></span>
                </button>
                <button
                  v-if="renamingTrack !== track.key"
                  class="icon-btn"
                  title="Rename track"
                  @click="startRenameTrack(track)"
                >
                  <span class="mdi mdi-pencil-outline"></span>
                </button>
                <button class="icon-btn danger" title="Delete track" @click="deleteTrack(track)">
                  <span class="mdi mdi-trash-can-outline"></span>
                </button>
              </li>
              <li v-if="!tracks.length" class="empty-hint">This album is empty. Upload some audio.</li>
            </ul>
          </template>
        </section>
      </div>

      <div class="playback-bar">
        <div class="now-playing">
          <span class="mdi mdi-music-note"></span>
          <span class="track-title">{{ currentTrack ? currentTrack.name : 'Nothing playing' }}</span>
        </div>

        <div class="playback-controls">
          <button class="icon-btn" :class="{ active: isShuffle }" title="Shuffle" @click="toggleShuffle">
            <span class="mdi mdi-shuffle-variant"></span>
          </button>
          <button class="icon-btn" title="Previous" @click="playPrev">
            <span class="mdi mdi-skip-previous"></span>
          </button>
          <button class="icon-btn play-btn" title="Play/Pause" @click="togglePlay">
            <span class="mdi" :class="isPlaying ? 'mdi-pause' : 'mdi-play'"></span>
          </button>
          <button class="icon-btn" title="Next" @click="playNext">
            <span class="mdi mdi-skip-next"></span>
          </button>
          <button class="icon-btn" :class="{ active: isRepeat }" title="Repeat" @click="toggleRepeat">
            <span class="mdi mdi-repeat"></span>
          </button>
        </div>

        <div class="seek-row">
          <span class="time">{{ formatTime(progress) }}</span>
          <input
            type="range" min="0" step="0.1"
            :max="duration || 0"
            :value="progress"
            class="seek-bar"
            @input="seek($event.target.valueAsNumber)"
          />
          <span class="time">{{ formatTime(duration) }}</span>
        </div>

        <div class="volume-row">
          <span class="mdi" :class="volume === 0 ? 'mdi-volume-mute' : 'mdi-volume-high'"></span>
          <input
            type="range" min="0" max="1" step="0.01"
            :value="volume"
            class="volume-bar"
            @input="setVolume($event.target.valueAsNumber)"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { nextTick, ref, watch } from 'vue'
import { usePlayer } from '@/composables/usePlayer'
import { useDragMove } from '@/composables/useDragMove'

const props = defineProps({
  isOpen: { type: Boolean, required: true }
})
const emit = defineEmits(['close'])

const {
  albums, currentAlbum, tracks, currentTrack, currentTrackIndex,
  isPlaying, isShuffle, isRepeat, loadingAlbums, loadingTracks, error,
  progress, duration, volume,
  loadAlbums, selectAlbum, playTrackAt, togglePlay, playNext, playPrev,
  toggleShuffle, toggleRepeat, seek, setVolume,
  createAlbum, deleteAlbum, renameAlbum, uploadTrack, deleteTrack: removeTrack, moveTrack, renameTrack
} = usePlayer()
const { dragOverTarget, startDrag, endDrag, dragOver, dragLeave, drop } = useDragMove()

async function onMove(track, destAlbum) {
  if (destAlbum === currentAlbum.value) return
  try {
    await moveTrack(track, destAlbum)
  } catch (e) {
    error.value = e.response?.data?.detail || 'Could not move the track.'
  }
}

const showNewAlbumInput = ref(false)
const newAlbumName = ref('')
const newAlbumInputRef = ref(null)
const pendingDeleteAlbum = ref(null)
const uploading = ref([])
const renamingAlbum = ref(null)
const renameValue = ref('')
const albumListRef = ref(null)
const renamingTrack = ref(null)
const trackRenameValue = ref('')
const trackListRef = ref(null)
const copiedTrack = ref(null)
let copiedTrackTimeout = null

let albumsLoaded = false
watch(() => props.isOpen, (open) => {
  if (open && !albumsLoaded) {
    albumsLoaded = true
    loadAlbums()
  }
})

function closeModal() {
  emit('close')
}

function startNewAlbum() {
  showNewAlbumInput.value = true
  nextTick(() => newAlbumInputRef.value?.focus())
}

async function submitNewAlbum() {
  const name = newAlbumName.value.trim()
  if (!name) return
  try {
    await createAlbum(name)
    newAlbumName.value = ''
    showNewAlbumInput.value = false
  } catch (e) {
    error.value = e.response?.data?.detail || 'Could not create the album.'
  }
}

async function confirmDeleteAlbum(album) {
  if (pendingDeleteAlbum.value !== album) {
    pendingDeleteAlbum.value = album
    return
  }
  pendingDeleteAlbum.value = null
  try {
    await deleteAlbum(album)
  } catch (e) {
    error.value = e.response?.data?.detail || 'Could not delete the album.'
  }
}

function startRenameAlbum(album) {
  renamingAlbum.value = album
  renameValue.value = album
  nextTick(() => {
    const el = albumListRef.value?.querySelector('.album-rename-input')
    el?.focus()
    el?.select()
  })
}

async function submitRenameAlbum(oldName) {
  if (renamingAlbum.value !== oldName) return
  const newName = renameValue.value.trim()
  renamingAlbum.value = null
  if (!newName || newName === oldName) return
  try {
    await renameAlbum(oldName, newName)
  } catch (e) {
    error.value = e.response?.data?.detail || 'Could not rename the album.'
  }
}

async function copyTrackKey(track) {
  try {
    await navigator.clipboard.writeText(track.key)
  } catch {
    return
  }
  copiedTrack.value = track.key
  clearTimeout(copiedTrackTimeout)
  copiedTrackTimeout = setTimeout(() => {
    if (copiedTrack.value === track.key) copiedTrack.value = null
  }, 1500)
}

async function deleteTrack(track) {
  try {
    await removeTrack(track)
  } catch (e) {
    error.value = e.response?.data?.detail || 'Could not delete the track.'
  }
}

function startRenameTrack(track) {
  renamingTrack.value = track.key
  trackRenameValue.value = track.name
  nextTick(() => {
    const el = trackListRef.value?.querySelector('.track-rename-input')
    el?.focus()
    el?.select()
  })
}

async function submitRenameTrack(track) {
  if (renamingTrack.value !== track.key) return
  const newName = trackRenameValue.value.trim()
  renamingTrack.value = null
  if (!newName || newName === track.name) return
  try {
    await renameTrack(track, newName)
  } catch (e) {
    error.value = e.response?.data?.detail || 'Could not rename the track.'
  }
}

let uploadEntryId = 0

async function onFilesSelected(event) {
  const files = Array.from(event.target.files || [])
  event.target.value = ''
  for (const file of files) {
    const id = ++uploadEntryId
    const entry = { id, name: file.name, progress: 0 }
    uploading.value.push(entry)
    try {
      await uploadTrack(file, (p) => { entry.progress = p })
    } catch (e) {
      error.value = e.response?.data?.detail || `Error uploading ${file.name}.`
    } finally {
      uploading.value = uploading.value.filter(u => u.id !== id)
    }
  }
}

function formatSize(bytes) {
  if (!bytes && bytes !== 0) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let size = bytes
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit++
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

function formatTime(seconds) {
  if (!seconds || Number.isNaN(seconds)) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal-content.player-modal-content {
  background: rgba(18, 19, 42, 0.98);
  border: 1px solid var(--border-light);
  border-radius: 12px;
  width: 95vw;
  max-width: 1100px;
  height: 85vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1.25rem 1.5rem;
  border-bottom: 1px solid var(--border-light);
  flex-shrink: 0;
}

.modal-header h2 {
  margin: 0;
  font-size: 1.25rem;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.close-btn {
  background: transparent;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 0.25rem;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.close-btn:hover {
  background: var(--interactive-secondary);
  color: var(--text-primary);
}

.close-btn .mdi {
  font-size: 1.5rem;
}

.modal-body.player-body {
  flex: 1;
  display: flex;
  overflow: hidden;
  min-height: 0;
}

/* ── Album list ─────────────────────────────────────────────── */
.album-list {
  width: 260px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border-light);
  padding: 1rem;
  overflow-y: auto;
}

.album-list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.75rem;
}

.album-list-header h3 {
  font-size: 0.875rem;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: var(--text-tertiary);
  font-weight: 600;
}

.new-album-form {
  display: flex;
  gap: 0.4rem;
  margin-bottom: 0.75rem;
}

.new-album-form input {
  flex: 1;
  min-width: 0;
  background: rgba(26, 27, 58, 0.6);
  border: 1px solid var(--border-light);
  border-radius: 6px;
  padding: 0.4rem 0.6rem;
  color: var(--text-primary);
  font-size: 1rem;
}

.new-album-form input:focus {
  outline: none;
  border-color: var(--interactive-primary);
}

.album-items {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.album-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.6rem;
  border-radius: 8px;
  cursor: pointer;
  color: var(--text-secondary);
  border: 1px solid transparent;
  transition: all 0.15s ease;
}

.album-item:hover {
  background: var(--interactive-secondary);
  color: var(--text-primary);
}

.album-item.active {
  background: rgba(138, 92, 245, 0.2);
  border-color: rgba(138, 92, 245, 0.5);
  color: var(--text-primary);
}

.album-item.drag-over {
  background: var(--interactive-primary);
  border-color: var(--interactive-primary);
  color: white;
}

.album-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.875rem;
}

.album-rename-input {
  flex: 1;
  min-width: 0;
  background: rgba(26, 27, 58, 0.6);
  border: 1px solid var(--interactive-primary);
  border-radius: 6px;
  padding: 0.2rem 0.4rem;
  color: var(--text-primary);
  font-size: 0.875rem;
}

.album-rename-input:focus {
  outline: none;
}

.album-hover-btn {
  opacity: 0;
  visibility: hidden;
}

.album-item:hover .album-hover-btn,
.album-hover-btn.force-visible {
  opacity: 1;
  visibility: visible;
}

/* ── Track panel ────────────────────────────────────────────── */
.track-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 1rem 1.5rem;
  overflow-y: auto;
  min-width: 0;
}

.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  color: var(--text-tertiary);
}

.empty-state .mdi {
  font-size: 3rem;
  opacity: 0.5;
}

.track-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1rem;
  flex-shrink: 0;
}

.track-panel-header h3 {
  color: var(--text-primary);
  font-size: 1.1rem;
}

.upload-btn {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.5rem 0.9rem;
  border: 1px solid var(--border-medium);
  border-radius: 8px;
  background: rgba(138, 92, 245, 0.15);
  color: var(--text-primary);
  font-size: 0.875rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.upload-btn:hover {
  background: rgba(138, 92, 245, 0.3);
  border-color: var(--interactive-primary);
}

.upload-progress-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.upload-progress-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-size: 0.8rem;
  color: var(--text-secondary);
}

.upload-name {
  width: 140px;
  flex-shrink: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.progress-track {
  flex: 1;
  height: 4px;
  background: rgba(138, 92, 245, 0.15);
  border-radius: 2px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--interactive-primary);
  transition: width 0.15s ease;
}

.track-items {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.track-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 0.6rem;
  border-radius: 8px;
  border: 1px solid transparent;
  color: var(--text-secondary);
  transition: all 0.15s ease;
}

.track-item:hover {
  background: var(--interactive-secondary);
}

.track-item.active {
  background: rgba(138, 92, 245, 0.15);
  border-color: rgba(138, 92, 245, 0.4);
  color: var(--text-primary);
}

.track-play-btn {
  background: transparent;
  border: none;
  color: inherit;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  flex-shrink: 0;
}

.track-play-btn:hover {
  background: rgba(138, 92, 245, 0.25);
}

.track-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.875rem;
}

.track-rename-input {
  flex: 1;
  min-width: 0;
  background: rgba(26, 27, 58, 0.6);
  border: 1px solid var(--interactive-primary);
  border-radius: 6px;
  padding: 0.2rem 0.4rem;
  color: var(--text-primary);
  font-size: 0.875rem;
}

.track-rename-input:focus {
  outline: none;
}

.track-size {
  font-size: 0.75rem;
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.empty-hint {
  color: var(--text-tertiary);
  font-size: 0.875rem;
  font-style: italic;
  padding: 0.5rem;
}

.hint-state {
  padding: 1rem 0.5rem;
  color: var(--text-secondary);
  font-size: 0.875rem;
}

.hint-state.error {
  color: var(--status-error, #f87171);
}

/* ── Shared icon buttons ────────────────────────────────────── */
.icon-btn {
  background: transparent;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 0.3rem;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
  flex-shrink: 0;
}

.icon-btn:hover {
  background: var(--interactive-secondary);
  color: var(--text-primary);
}

.icon-btn.active {
  color: var(--interactive-primary);
  background: rgba(138, 92, 245, 0.2);
}

.icon-btn.danger:hover {
  color: var(--status-error, #f87171);
  background: rgba(248, 113, 113, 0.15);
}

/* ── Playback bar ───────────────────────────────────────────── */
.playback-bar {
  flex-shrink: 0;
  border-top: 1px solid var(--border-light);
  padding: 0.85rem 1.5rem;
  display: flex;
  align-items: center;
  gap: 1.5rem;
  background: rgba(12, 13, 29, 0.6);
}

.now-playing {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 200px;
  flex-shrink: 0;
  color: var(--text-secondary);
  font-size: 0.875rem;
  overflow: hidden;
}

.now-playing .track-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.playback-controls {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-shrink: 0;
}

.play-btn {
  width: 36px;
  height: 36px;
  background: var(--interactive-primary);
  color: white;
  border-radius: 50%;
}

.play-btn:hover {
  background: var(--interactive-primaryHover);
  color: white;
}

.play-btn .mdi {
  font-size: 1.2rem;
}

.seek-row {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 0.6rem;
  min-width: 120px;
}

.time {
  font-size: 0.75rem;
  color: var(--text-tertiary);
  min-width: 34px;
  text-align: center;
}

.seek-bar, .volume-bar {
  accent-color: var(--interactive-primary);
  cursor: pointer;
}

.seek-bar {
  flex: 1;
}

.volume-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 120px;
  flex-shrink: 0;
  color: var(--text-secondary);
}

.volume-bar {
  width: 80px;
}

@media (max-width: 768px) {
  .modal-content.player-modal-content {
    height: 92vh;
  }

  .player-body {
    flex-direction: column;
  }

  .album-list {
    width: 100%;
    max-height: 35%;
    border-right: none;
    border-bottom: 1px solid var(--border-light);
  }

  .playback-bar {
    flex-wrap: wrap;
    gap: 0.75rem;
  }

  .now-playing {
    width: 100%;
  }

  .volume-row {
    display: none;
  }
}
</style>
