import { ref, computed } from 'vue'
import {
  fetchAlbums,
  createAlbum as apiCreateAlbum,
  deleteAlbum as apiDeleteAlbum,
  renameAlbum as apiRenameAlbum,
  fetchTracks,
  uploadTrack as apiUploadTrack,
  deleteTrack as apiDeleteTrack,
  moveTrack as apiMoveTrack,
  streamUrl
} from '@/api/player'

// Module-level (singleton) state: playback survives closing the player modal
// or navigating away, since the same <audio> element keeps running.
const audio = new Audio()

const albums = ref([])
const currentAlbum = ref(null)
const tracks = ref([])
const currentTrackIndex = ref(-1)
const isPlaying = ref(false)
const isShuffle = ref(false)
const isRepeat = ref(false)
const shuffleOrder = ref([])
const loadingAlbums = ref(false)
const loadingTracks = ref(false)
const error = ref(null)
const progress = ref(0)
const duration = ref(0)
const volume = ref(1)

const currentTrack = computed(() => tracks.value[currentTrackIndex.value] || null)

function generateShuffleOrder() {
  const indices = tracks.value.map((_, i) => i)
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[indices[i], indices[j]] = [indices[j], indices[i]]
  }
  shuffleOrder.value = indices
}

function playTrackAt(index) {
  if (index < 0 || index >= tracks.value.length) return
  currentTrackIndex.value = index
  audio.src = streamUrl(tracks.value[index].key)
  audio.play()
}

// Plays a track referenced by its key ("Album/filename.mp3"), as used by the
// song-link buttons rendered from notes. Loads the album's track list first
// if it isn't the one currently selected.
async function playByKey(key) {
  const slashIndex = key.indexOf('/')
  if (slashIndex === -1) throw new Error(`Invalid track key: ${key}`)
  const album = key.slice(0, slashIndex)
  if (currentAlbum.value !== album) {
    await selectAlbum(album)
  }
  const index = tracks.value.findIndex(t => t.key === key)
  if (index === -1) throw new Error(`Track not found: ${key}`)
  playTrackAt(index)
}

function playNext() {
  if (!tracks.value.length) return
  if (isShuffle.value) {
    const pos = shuffleOrder.value.indexOf(currentTrackIndex.value)
    const nextPos = pos + 1
    if (nextPos >= shuffleOrder.value.length) return
    playTrackAt(shuffleOrder.value[nextPos])
  } else {
    const next = currentTrackIndex.value + 1
    if (next >= tracks.value.length) return
    playTrackAt(next)
  }
}

// Called when the current track finishes on its own. Repeat means "loop the
// track that's playing", separate from the Next button which always advances
// (skipping manually is not affected by repeat).
function handleTrackEnded() {
  if (isRepeat.value) {
    playTrackAt(currentTrackIndex.value)
  } else {
    playNext()
  }
}

function playPrev() {
  if (!tracks.value.length) return
  if (isShuffle.value) {
    const pos = shuffleOrder.value.indexOf(currentTrackIndex.value)
    const prevPos = pos - 1
    if (prevPos < 0) return
    playTrackAt(shuffleOrder.value[prevPos])
  } else {
    const prev = currentTrackIndex.value - 1
    if (prev < 0) return
    playTrackAt(prev)
  }
}

audio.addEventListener('timeupdate', () => { progress.value = audio.currentTime })
audio.addEventListener('loadedmetadata', () => { duration.value = audio.duration })
audio.addEventListener('ended', handleTrackEnded)
audio.addEventListener('play', () => { isPlaying.value = true })
audio.addEventListener('pause', () => { isPlaying.value = false })

let loadAlbumsToken = 0

async function loadAlbums() {
  const token = ++loadAlbumsToken
  loadingAlbums.value = true
  error.value = null
  try {
    const result = await fetchAlbums()
    if (token !== loadAlbumsToken) return
    albums.value = result
  } catch (e) {
    if (token !== loadAlbumsToken) return
    error.value = e.response?.data?.detail || 'Could not load albums.'
  } finally {
    if (token === loadAlbumsToken) loadingAlbums.value = false
  }
}

// Guards against out-of-order responses: if selectAlbum is called again
// (switch album, or a delete/upload triggering a refresh) before an earlier
// call's fetch resolves, only the most recent call is allowed to commit
// its result into `tracks`.
let selectAlbumToken = 0

async function selectAlbum(name) {
  const token = ++selectAlbumToken
  currentAlbum.value = name
  loadingTracks.value = true
  error.value = null
  try {
    const result = await fetchTracks(name)
    if (token !== selectAlbumToken) return
    tracks.value = result
    currentTrackIndex.value = -1
    generateShuffleOrder()
  } catch (e) {
    if (token !== selectAlbumToken) return
    error.value = e.response?.data?.detail || 'Could not load tracks.'
    tracks.value = []
  } finally {
    if (token === selectAlbumToken) loadingTracks.value = false
  }
}

function togglePlay() {
  if (!currentTrack.value) {
    if (tracks.value.length) playTrackAt(0)
    return
  }
  if (audio.paused) audio.play()
  else audio.pause()
}

function toggleShuffle() {
  isShuffle.value = !isShuffle.value
  if (isShuffle.value) generateShuffleOrder()
}

function toggleRepeat() {
  isRepeat.value = !isRepeat.value
}

function seek(time) {
  audio.currentTime = time
}

function setVolume(v) {
  volume.value = v
  audio.volume = v
}

function resetPlayback() {
  audio.pause()
  audio.removeAttribute('src')
  currentTrackIndex.value = -1
}

async function createAlbum(name) {
  await apiCreateAlbum(name)
  await loadAlbums()
}

async function deleteAlbum(name) {
  await apiDeleteAlbum(name)
  if (currentAlbum.value === name) {
    currentAlbum.value = null
    tracks.value = []
    resetPlayback()
  }
  await loadAlbums()
}

async function renameAlbum(oldName, newName) {
  await apiRenameAlbum(oldName, newName)
  if (currentAlbum.value === oldName) {
    resetPlayback()
    await selectAlbum(newName)
  }
  await loadAlbums()
}

async function uploadTrack(file, onProgress) {
  if (!currentAlbum.value) return
  await apiUploadTrack(currentAlbum.value, file, onProgress)
  await selectAlbum(currentAlbum.value)
}

async function deleteTrack(track) {
  const wasCurrent = currentTrack.value?.key === track.key
  await apiDeleteTrack(track.key)
  if (wasCurrent) resetPlayback()
  await selectAlbum(currentAlbum.value)
}

async function moveTrack(track, destAlbum) {
  const wasCurrent = currentTrack.value?.key === track.key
  await apiMoveTrack(track.key, destAlbum)
  if (wasCurrent) resetPlayback()
  await selectAlbum(currentAlbum.value)
}

export function usePlayer() {
  return {
    albums, currentAlbum, tracks, currentTrack, currentTrackIndex,
    isPlaying, isShuffle, isRepeat, loadingAlbums, loadingTracks, error,
    progress, duration, volume,
    loadAlbums, selectAlbum, playTrackAt, playByKey, togglePlay, playNext, playPrev,
    toggleShuffle, toggleRepeat, seek, setVolume,
    createAlbum, deleteAlbum, renameAlbum, uploadTrack, deleteTrack, moveTrack
  }
}
