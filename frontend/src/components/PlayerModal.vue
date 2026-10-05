<template>
  <div v-if="isOpen" class="rk-scrim" @click.self="closeModal">
    <div class="rk-dialog player-modal-content" role="dialog" aria-modal="true" aria-labelledby="player-modal-title">
      <div class="rk-dialog__header">
        <h2 id="player-modal-title" class="rk-dialog__title"><span class="mdi mdi-music-box-multiple-outline"></span> Player</h2>
        <button class="rk-icon-btn" aria-label="Close player" @click="closeModal">
          <span class="mdi mdi-close"></span>
        </button>
      </div>

      <div class="player-body">
        <aside class="album-list">
          <div class="album-list-header">
            <h3 class="rk-overline">Albums</h3>
            <button class="rk-icon-btn rk-icon-btn--sm" title="New album" aria-label="New album" @click="startNewAlbum">
              <span class="mdi mdi-folder-plus-outline"></span>
            </button>
          </div>

          <div v-if="showNewAlbumInput" class="new-album-form">
            <input
              ref="newAlbumInputRef"
              v-model="newAlbumName"
              class="rk-input album-name-input"
              placeholder="Album name"
              aria-label="Album name"
              @keyup.enter="submitNewAlbum"
              @keyup.esc="showNewAlbumInput = false"
            />
            <button class="rk-icon-btn rk-icon-btn--sm" aria-label="Create album" @click="submitNewAlbum"><span class="mdi mdi-check"></span></button>
            <button class="rk-icon-btn rk-icon-btn--sm" aria-label="Cancel" @click="showNewAlbumInput = false"><span class="mdi mdi-close"></span></button>
          </div>

          <div v-if="loadingAlbums" class="album-skeleton" role="status" aria-label="Loading albums">
            <div v-for="n in 5" :key="n" class="rk-skeleton album-skeleton-row"></div>
          </div>
          <div v-else-if="error && !albums.length" class="rk-alert" role="alert">
            <span class="mdi mdi-alert-circle-outline"></span>
            <span>{{ error }}</span>
          </div>
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
                aria-label="Album name"
                @click.stop
                @keyup.enter="submitRenameAlbum(album)"
                @keyup.esc="renamingAlbum = null"
                @blur="submitRenameAlbum(album)"
              />
              <span v-else class="album-name">{{ album }}</span>
              <button
                v-if="renamingAlbum !== album"
                class="rk-icon-btn rk-icon-btn--sm album-hover-btn"
                :class="{ 'force-visible': pendingDeleteAlbum === album }"
                title="Rename album"
                aria-label="Rename album"
                @click.stop="startRenameAlbum(album)"
              >
                <span class="mdi mdi-pencil-outline"></span>
              </button>
              <button
                class="rk-icon-btn rk-icon-btn--sm danger album-hover-btn"
                :class="{ 'force-visible': pendingDeleteAlbum === album }"
                :title="pendingDeleteAlbum === album ? 'Confirm delete' : 'Delete album'"
                :aria-label="pendingDeleteAlbum === album ? 'Confirm delete' : 'Delete album'"
                @click.stop="confirmDeleteAlbum(album)"
              >
                <span class="mdi" :class="pendingDeleteAlbum === album ? 'mdi-check-circle' : 'mdi-trash-can-outline'"></span>
              </button>
            </li>
            <li v-if="!albums.length" class="empty-hint">No albums yet. Use the folder button above to create one.</li>
          </ul>
        </aside>

        <section class="track-panel">
          <div v-if="!currentAlbum" class="rk-empty empty-state">
            <span class="mdi mdi-music-note-outline"></span>
            <p>Select or create an album to see its tracks.</p>
          </div>
          <template v-else>
            <div class="track-panel-header">
              <h3>{{ currentAlbum }}</h3>
              <label class="rk-btn upload-btn">
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

            <div v-if="loadingTracks" class="track-skeleton" role="status" aria-label="Loading tracks">
              <div v-for="n in 6" :key="n" class="rk-skeleton track-skeleton-row"></div>
            </div>
            <div v-else-if="error" class="rk-alert" role="alert">
              <span class="mdi mdi-alert-circle-outline"></span>
              <span>{{ error }}</span>
            </div>
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
                <div class="track-play-group">
                  <button class="track-play-btn" :title="`Play ${track.name}`" :aria-label="`Play ${track.name}`" @click="playTrackAt(idx)">
                    <span class="mdi" :class="idx === currentTrackIndex && isPlaying ? 'mdi-volume-high' : 'mdi-play'"></span>
                  </button>
                  <button
                    class="track-play-btn sfx-play-btn"
                    :class="{ 'is-sounding': sfxPlaying[track.key] }"
                    :title="sfxPlaying[track.key] ? 'Stop effect' : 'Play as effect, over the music'"
                    :aria-label="sfxPlaying[track.key] ? `Stop effect ${track.name}` : `Play ${track.name} as effect`"
                    :aria-pressed="!!sfxPlaying[track.key]"
                    @click="toggleSfx(track.key)"
                  >
                    <span class="mdi" :class="sfxPlaying[track.key] ? 'mdi-stop' : 'mdi-waveform'"></span>
                  </button>
                </div>
                <input
                  v-if="renamingTrack === track.key"
                  v-model="trackRenameValue"
                  class="track-rename-input"
                  aria-label="Track name"
                  @click.stop
                  @keyup.enter="submitRenameTrack(track)"
                  @keyup.esc="renamingTrack = null"
                  @blur="submitRenameTrack(track)"
                />
                <span v-else class="track-name">{{ track.name }}</span>
                <span class="track-size">{{ formatSize(track.size) }}</span>
                <div v-if="renamingTrack !== track.key" class="copy-menu-anchor">
                  <button
                    class="rk-icon-btn rk-icon-btn--sm"
                    :class="{ 'is-active': copyMenuFor === track.key }"
                    :title="copiedTrack === track.key ? 'Copied!' : 'Copy reference for a note'"
                    :aria-label="copiedTrack === track.key ? 'Copied' : 'Copy reference for a note'"
                    aria-haspopup="menu"
                    :aria-expanded="copyMenuFor === track.key"
                    @click.stop="copyMenuFor = copyMenuFor === track.key ? null : track.key"
                  >
                    <span class="mdi" :class="copiedTrack === track.key ? 'mdi-check' : 'mdi-content-copy'"></span>
                  </button>
                  <div v-if="copyMenuFor === track.key" class="copy-menu" role="menu" @click.stop>
                    <button class="copy-menu-item" role="menuitem" @click="copyTrackRef(track, 'song')">
                      <span class="mdi mdi-play-circle-outline"></span>
                      <span>As music</span>
                      <code>{{ track.key }}</code>
                    </button>
                    <button class="copy-menu-item" role="menuitem" @click="copyTrackRef(track, 'sfx')">
                      <span class="mdi mdi-waveform"></span>
                      <span>As effect</span>
                      <code>sfx:{{ track.key }}</code>
                    </button>
                  </div>
                </div>
                <button
                  v-if="renamingTrack !== track.key"
                  class="rk-icon-btn rk-icon-btn--sm"
                  title="Rename track"
                  aria-label="Rename track"
                  @click="startRenameTrack(track)"
                >
                  <span class="mdi mdi-pencil-outline"></span>
                </button>
                <button class="rk-icon-btn rk-icon-btn--sm danger" title="Delete track" aria-label="Delete track" @click="deleteTrack(track)">
                  <span class="mdi mdi-trash-can-outline"></span>
                </button>
              </li>
              <li v-if="!tracks.length" class="rk-empty">
                <span class="mdi mdi-playlist-music-outline"></span>
                <p>This album is empty.</p>
                <p class="rk-hint">Upload some audio.</p>
              </li>
            </ul>
          </template>
        </section>
      </div>

      <div class="playback-bar">
        <div class="now-playing">
          <span class="mdi mdi-music-note" :class="{ 'is-playing': isPlaying }"></span>
          <span class="track-title">{{ currentTrack ? currentTrack.name : 'Nothing playing' }}</span>
        </div>

        <div class="playback-controls">
          <button class="rk-icon-btn" :class="{ 'is-active': isShuffle }" title="Shuffle" aria-label="Shuffle" :aria-pressed="isShuffle" @click="toggleShuffle">
            <span class="mdi mdi-shuffle-variant"></span>
          </button>
          <button class="rk-icon-btn" title="Previous" aria-label="Previous track" @click="playPrev">
            <span class="mdi mdi-skip-previous"></span>
          </button>
          <button class="rk-icon-btn play-btn" title="Play/Pause" :aria-label="isPlaying ? 'Pause' : 'Play'" @click="togglePlay">
            <span class="mdi" :class="isPlaying ? 'mdi-pause' : 'mdi-play'"></span>
          </button>
          <button class="rk-icon-btn" title="Next" aria-label="Next track" @click="playNext">
            <span class="mdi mdi-skip-next"></span>
          </button>
          <button class="rk-icon-btn" :class="{ 'is-active': isRepeat }" title="Repeat" aria-label="Repeat" :aria-pressed="isRepeat" @click="toggleRepeat">
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
            aria-label="Seek"
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
            aria-label="Volume"
            @input="setVolume($event.target.valueAsNumber)"
          />
        </div>

        <div class="volume-row sfx-row" :class="{ 'is-sounding': sfxPlayingKeys.length }">
          <span class="mdi mdi-waveform" title="Effects volume" aria-hidden="true"></span>
          <input
            type="range" min="0" max="1" step="0.01"
            :value="sfxVolume"
            class="volume-bar"
            aria-label="Effects volume"
            @input="setSfxVolume($event.target.valueAsNumber)"
          />
          <button
            class="rk-icon-btn rk-icon-btn--sm"
            :disabled="!sfxPlayingKeys.length"
            title="Stop all effects"
            aria-label="Stop all effects"
            @click="stopAllSfx"
          >
            <span class="mdi mdi-stop"></span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { usePlayer } from '@/composables/usePlayer'
import { useDragMove } from '@/composables/useDragMove'
import { useCopyToClipboard } from '@/composables/useCopyToClipboard'
import { useSoundEffects } from '@/composables/useSoundEffects'
import { sfxRefMarkdown } from '@/utils/audioLink'

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
const {
  playing: sfxPlaying, playingKeys: sfxPlayingKeys, volume: sfxVolume,
  toggle: toggleEffect, stopAll: stopAllSfx, setVolume: setSfxVolume
} = useSoundEffects()
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
const { copiedKey: copiedTrack, copy } = useCopyToClipboard()

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

// A note turns `Album/track.mp3` into a music link and `sfx:Album/track.mp3`
// into a sound-effect button (utils/inlineRefs.js).
const copyMenuFor = ref(null)

function copyTrackRef(track, as) {
  copyMenuFor.value = null
  copy(as === 'sfx' ? sfxRefMarkdown(track.key) : '`' + track.key + '`', track.key)
}

function closeCopyMenu(e) {
  if (e.type === 'keydown' && e.key !== 'Escape') return
  copyMenuFor.value = null
}

watch(copyMenuFor, (key) => {
  const method = key ? 'addEventListener' : 'removeEventListener'
  document[method]('click', closeCopyMenu)
  document[method]('keydown', closeCopyMenu)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', closeCopyMenu)
  document.removeEventListener('keydown', closeCopyMenu)
})

async function toggleSfx(key) {
  try {
    await toggleEffect(key)
  } catch {
    error.value = 'Could not play the effect.'
  }
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
/* Shell comes from .rk-scrim / .rk-dialog; only the player's size lives here. */
.player-modal-content {
  width: min(100%, 1100px);
  height: 85dvh;
}

.player-body {
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
  padding: var(--space-4);
  overflow-y: auto;
}

.album-list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-3);
}

.new-album-form {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  margin-bottom: var(--space-3);
}

.album-name-input {
  flex: 1;
  min-width: 0;
  min-height: var(--control-md);
  font-size: var(--text-sm);
}

.album-items {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.album-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--control-md);
  padding: 0 var(--space-1) 0 var(--space-2);
  border-radius: var(--radius-md);
  border: 1px solid transparent;
  cursor: pointer;
  color: var(--text-secondary);
  transition:
    background-color var(--duration-fast) var(--ease-out),
    border-color var(--duration-fast) var(--ease-out),
    color var(--duration-fast) var(--ease-out);
}

.album-item:hover {
  background: var(--hover-tint);
  color: var(--text-primary);
}

.album-item.active {
  background: var(--accent-a20);
  border-color: var(--accent-a45);
  color: var(--text-primary);
}

.album-item.drag-over {
  background: var(--accent-strong);
  border-color: var(--accent-strong);
  color: var(--accent-contrast);
}

.album-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-sm);
}

.album-rename-input,
.track-rename-input {
  flex: 1;
  min-width: 0;
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--accent);
  border-radius: var(--radius-sm);
  background: var(--surface-sunken);
  color: var(--text-primary);
  font-size: var(--text-sm);
}

.album-rename-input:focus,
.album-rename-input:focus-visible,
.track-rename-input:focus,
.track-rename-input:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px var(--accent-a20);
  border-radius: var(--radius-sm);
}

/* Hidden with opacity only, so keyboard users can still Tab to them. */
.album-hover-btn {
  opacity: 0;
  pointer-events: none;
}

.album-item:hover .album-hover-btn,
.album-item:focus-within .album-hover-btn,
.album-hover-btn.force-visible {
  opacity: 1;
  pointer-events: auto;
}

@media (hover: none) {
  .album-hover-btn {
    opacity: 1;
    pointer-events: auto;
  }
}

.album-skeleton,
.track-skeleton {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.album-skeleton-row,
.track-skeleton-row {
  height: var(--control-md);
  border-radius: var(--radius-md);
}

/* ── Track panel ────────────────────────────────────────────── */
.track-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: var(--space-4) var(--space-6);
  overflow-y: auto;
  min-width: 0;
}

.empty-state {
  flex: 1;
}

.track-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  margin-bottom: var(--space-4);
  flex-shrink: 0;
}

.track-panel-header h3 {
  color: var(--text-primary);
  font-size: var(--text-lg);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.upload-progress-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin-bottom: var(--space-4);
}

.upload-progress-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  font-size: var(--text-xs);
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
  overflow: hidden;
  border-radius: var(--radius-full);
  background: var(--accent-a20);
}

.progress-fill {
  height: 100%;
  background: var(--accent);
  transition: width var(--duration-fast) var(--ease-out);
}

.track-items {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.track-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: var(--control-lg);
  padding: 0 var(--space-2);
  border-radius: var(--radius-md);
  border: 1px solid transparent;
  color: var(--text-secondary);
  transition:
    background-color var(--duration-fast) var(--ease-out),
    border-color var(--duration-fast) var(--ease-out),
    color var(--duration-fast) var(--ease-out);
}

.track-item:hover {
  background: var(--hover-tint);
}

.track-item.active {
  background: var(--accent-a12);
  border-color: var(--accent-a45);
  color: var(--text-primary);
}

.track-item.active .track-play-btn {
  color: var(--accent-hover);
}

.track-play-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: var(--control-sm);
  height: var(--control-sm);
  border: none;
  border-radius: var(--radius-full);
  background: transparent;
  color: inherit;
  transition: background-color var(--duration-fast) var(--ease-out), transform var(--duration-fast) var(--ease-out);
}

.track-play-btn:hover {
  background: var(--accent-a30);
}

.track-play-btn:active {
  transform: scale(0.92);
}

/* Play as music / play as effect: the two ways a track sounds, side by side. */
.track-play-group {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.sfx-play-btn {
  color: var(--text-muted);
}

.sfx-play-btn:hover {
  background: rgba(251, 191, 36, 0.18);
  color: #fcd34d;
}

.sfx-play-btn.is-sounding {
  background: rgba(251, 191, 36, 0.22);
  color: #fcd34d;
}

.copy-menu-anchor {
  position: relative;
  flex-shrink: 0;
}

.copy-menu {
  position: absolute;
  top: calc(100% + var(--space-1));
  right: 0;
  z-index: 2;
  display: flex;
  flex-direction: column;
  min-width: 240px;
  padding: var(--space-1);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  background: var(--surface-overlay);
  box-shadow: var(--shadow-md);
}

.copy-menu-item {
  display: grid;
  grid-template-columns: auto 1fr;
  column-gap: var(--space-2);
  align-items: center;
  padding: var(--space-2);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-primary);
  font-size: var(--text-sm);
  text-align: left;
  cursor: pointer;
}

.copy-menu-item:hover,
.copy-menu-item:focus-visible {
  background: var(--hover-tint);
}

.copy-menu-item code {
  grid-column: 2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
}

.track-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-sm);
}

.track-size {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--text-muted);
  flex-shrink: 0;
}

.empty-hint {
  padding: var(--space-2);
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.rk-icon-btn.danger:hover:not(:disabled) {
  background: var(--status-error-bg);
  color: var(--status-error);
}

/* ── Playback bar ───────────────────────────────────────────── */
.playback-bar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: var(--space-6);
  padding: var(--space-3) var(--space-6);
  border-top: 1px solid var(--border-light);
  background: var(--surface-sunken);
}

.now-playing {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 200px;
  flex-shrink: 0;
  overflow: hidden;
  color: var(--text-secondary);
  font-size: var(--text-sm);
}

.now-playing .mdi.is-playing {
  color: var(--accent-hover);
}

.now-playing .track-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.playback-controls {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  flex-shrink: 0;
}

.play-btn {
  border-radius: var(--radius-full);
  background: var(--accent-strong);
  color: var(--accent-contrast);
}

.play-btn:hover:not(:disabled) {
  background: var(--accent-strong-hover);
  color: var(--accent-contrast);
}

.seek-row {
  flex: 1;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 120px;
}

.time {
  min-width: 34px;
  text-align: center;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.seek-bar,
.volume-bar {
  accent-color: var(--accent);
  cursor: pointer;
}

.seek-bar {
  flex: 1;
}

.volume-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 120px;
  flex-shrink: 0;
  color: var(--text-secondary);
}

.volume-bar {
  width: 80px;
}

.sfx-row {
  width: auto;
}

.sfx-row.is-sounding > .mdi-waveform {
  color: #fcd34d;
}

.sfx-row .volume-bar {
  accent-color: #fbbf24;
}

@media (max-width: 768px) {
  .player-modal-content {
    height: 92dvh;
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

  .track-panel {
    padding: var(--space-4);
  }

  .playback-bar {
    flex-wrap: wrap;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
  }

  .now-playing {
    width: 100%;
  }

  .volume-row {
    display: none;
  }
}
</style>
