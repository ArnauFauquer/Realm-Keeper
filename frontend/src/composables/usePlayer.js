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
  renameTrack as apiRenameTrack,
  streamUrl
} from '@/api/player'
import { errorMessage } from '@/api/http'

// Module-level (singleton) state: playback survives closing the player modal
// or navigating away, since the same <audio> element keeps running.
const audio = new Audio()

// What the player modal is browsing: an album and its tracks.
const albums = ref([])
const currentAlbum = ref(null)
const tracks = ref([])
const loadingAlbums = ref(false)
const loadingTracks = ref(false)
const albumsError = ref(null)
const tracksError = ref(null)

// What is playing: the album a track was started from and its tracks (the
// play queue), kept apart from the album being browsed - opening another
// album doesn't touch the music, and Next keeps to the album that plays. The
// track playing is known by its key, so a refreshed track list (an upload,
// a rename) can't shift it onto another song.
const queueAlbum = ref(null)
const playingTracks = ref([])
const playingKey = ref(null)
// Keys of playingTracks in shuffled order.
const shuffleOrder = ref([])

const isPlaying = ref(false)
const isShuffle = ref(false)
const isRepeat = ref(false)
const progress = ref(0)
const duration = ref(0)
const volume = ref(1)
// The last track that wouldn't play (blocked autoplay, missing file).
const playError = ref(null)

const currentTrack = computed(() => playingTracks.value.find(t => t.key === playingKey.value) || null)
// Where the playing track is in the album being browsed, -1 if elsewhere.
const currentTrackIndex = computed(() => playingKey.value ? tracks.value.findIndex(t => t.key === playingKey.value) : -1)

function albumOf(key) {
  return key.slice(0, key.indexOf('/'))
}

function shuffled(keys) {
  const order = keys.slice()
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  return order
}

function generateShuffleOrder() {
  shuffleOrder.value = shuffled(playingTracks.value.map(t => t.key))
}

// Makes `list` the play queue. The same album again (a refreshed list) keeps
// its shuffle order: tracks gone are dropped, new ones come last.
function setQueue(album, list) {
  const sameAlbum = queueAlbum.value === album
  queueAlbum.value = album
  playingTracks.value = list.slice()
  if (!sameAlbum) {
    generateShuffleOrder()
    return
  }
  const keys = new Set(list.map(t => t.key))
  const kept = shuffleOrder.value.filter(k => keys.has(k))
  const added = list.map(t => t.key).filter(k => !kept.includes(k))
  shuffleOrder.value = kept.concat(shuffled(added))
}

function clearQueue() {
  queueAlbum.value = null
  playingTracks.value = []
  shuffleOrder.value = []
}

// Starts a track of the queue. Resolves once it plays and rejects if it
// can't (autoplay blocked, missing file), after noting it in playError. A
// play cut short by the next one (AbortError) is not a failure.
function playKey(key) {
  playingKey.value = key
  audio.src = streamUrl(key)
  return started(audio.play(), key)
}

function started(playing, key) {
  return Promise.resolve(playing).then(
    () => { playError.value = null },
    (e) => {
      if (e?.name === 'AbortError') return
      const track = playingTracks.value.find(t => t.key === key)
      playError.value = `Could not play ${track?.name || key}.`
      throw e
    }
  )
}

// For the transport buttons and the end of a track, which nobody awaits:
// the failure is already in playError.
function quietly(promise) {
  promise?.catch(() => {})
}

/** Plays the track at `index` of the album being browsed, which becomes the
 * play queue. Returns the play() promise: it rejects if the track can't play. */
function playTrackAt(index) {
  if (index < 0 || index >= tracks.value.length) return Promise.resolve()
  setQueue(currentAlbum.value, tracks.value)
  return playKey(tracks.value[index].key)
}

// Plays a track referenced by its key ("Album/filename.mp3"), as used by the
// song-link buttons rendered from notes. Loads the album's track list first
// if it isn't the one currently selected. Rejects if the track is missing or
// won't play, so the link can show it.
async function playByKey(key) {
  const slashIndex = key.indexOf('/')
  if (slashIndex === -1) throw new Error(`Invalid track key: ${key}`)
  const album = key.slice(0, slashIndex)
  if (currentAlbum.value !== album) {
    await selectAlbum(album)
  }
  const index = tracks.value.findIndex(t => t.key === key)
  if (index === -1) throw new Error(`Track not found: ${key}`)
  return playTrackAt(index)
}

// Nothing started yet: the transport plays the album being browsed.
function ensureQueue() {
  if (!playingTracks.value.length && tracks.value.length) setQueue(currentAlbum.value, tracks.value)
}

// The key `step` places after (1) or before (-1) the playing track, in
// shuffle order or album order; null past either end. With nothing playing,
// 1 is the first track.
function keyAt(step) {
  if (isShuffle.value) return shuffleOrder.value[shuffleOrder.value.indexOf(playingKey.value) + step] ?? null
  const index = playingTracks.value.findIndex(t => t.key === playingKey.value)
  return playingTracks.value[index + step]?.key ?? null
}

function playNext() {
  ensureQueue()
  const key = keyAt(1)
  if (key) quietly(playKey(key))
}

function playPrev() {
  ensureQueue()
  const key = keyAt(-1)
  if (key) quietly(playKey(key))
}

// Called when the current track finishes on its own. Repeat means "loop the
// track that's playing", separate from the Next button which always advances
// (skipping manually is not affected by repeat).
function handleTrackEnded() {
  if (isRepeat.value && playingKey.value) {
    quietly(playKey(playingKey.value))
  } else {
    playNext()
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
  albumsError.value = null
  try {
    const result = await fetchAlbums()
    if (token !== loadAlbumsToken) return
    albums.value = result
  } catch (e) {
    if (token !== loadAlbumsToken) return
    albumsError.value = errorMessage(e, 'Could not load albums.')
  } finally {
    if (token === loadAlbumsToken) loadingAlbums.value = false
  }
}

// Guards against out-of-order responses: if selectAlbum is called again
// (switch album, or a delete/upload triggering a refresh) before an earlier
// call's fetch resolves, only the most recent call is allowed to commit
// its result into `tracks`. Browsing only: the music goes on, though a
// fresh list of the album that plays also refreshes the queue.
let selectAlbumToken = 0

async function selectAlbum(name) {
  const token = ++selectAlbumToken
  currentAlbum.value = name
  loadingTracks.value = true
  tracksError.value = null
  try {
    const result = await fetchTracks(name)
    if (token !== selectAlbumToken) return
    tracks.value = result
    if (name === queueAlbum.value) setQueue(name, result)
  } catch (e) {
    if (token !== selectAlbumToken) return
    tracksError.value = errorMessage(e, 'Could not load tracks.')
    tracks.value = []
  } finally {
    if (token === selectAlbumToken) loadingTracks.value = false
  }
}

// After a change to an album's tracks: refetch it if it is browsed or plays.
async function refreshAlbum(album) {
  if (album === currentAlbum.value) {
    await selectAlbum(album)
  } else if (album === queueAlbum.value) {
    const result = await fetchTracks(album)
    if (album === queueAlbum.value) setQueue(album, result)
  }
}

function togglePlay() {
  if (!currentTrack.value) {
    if (tracks.value.length) quietly(playTrackAt(0))
    return
  }
  // Resumes where it was paused.
  if (audio.paused) quietly(started(audio.play(), playingKey.value))
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
  playingKey.value = null
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
  }
  if (queueAlbum.value === name) {
    resetPlayback()
    clearQueue()
  }
  await loadAlbums()
}

// Renaming changes every track key of the album, so its music stops: the
// track playing would be streamed from a key that no longer exists.
async function renameAlbum(oldName, newName) {
  await apiRenameAlbum(oldName, newName)
  if (queueAlbum.value === oldName) {
    resetPlayback()
    clearQueue()
  }
  if (currentAlbum.value === oldName) await selectAlbum(newName)
  await loadAlbums()
}

/** Uploads into `album` - the one browsed when the upload began, so that
 * switching albums during a batch doesn't send the rest elsewhere. */
async function uploadTrack(file, onProgress, album = currentAlbum.value) {
  if (!album) return
  await apiUploadTrack(album, file, onProgress)
  await refreshAlbum(album)
}

async function deleteTrack(track) {
  const wasCurrent = playingKey.value === track.key
  await apiDeleteTrack(track.key)
  if (wasCurrent) resetPlayback()
  await refreshAlbum(albumOf(track.key))
}

async function moveTrack(track, destAlbum) {
  const wasCurrent = playingKey.value === track.key
  const source = albumOf(track.key)
  await apiMoveTrack(track.key, destAlbum)
  if (wasCurrent) resetPlayback()
  await refreshAlbum(source)
  if (destAlbum !== source) await refreshAlbum(destAlbum)
}

async function renameTrack(track, newName) {
  const wasCurrent = playingKey.value === track.key
  await apiRenameTrack(track.key, newName)
  if (wasCurrent) resetPlayback()
  await refreshAlbum(albumOf(track.key))
}

export function usePlayer() {
  return {
    albums, currentAlbum, tracks, currentTrack, currentTrackIndex,
    queueAlbum, playingTracks, playingKey,
    isPlaying, isShuffle, isRepeat, loadingAlbums, loadingTracks, albumsError, tracksError, playError,
    progress, duration, volume,
    loadAlbums, selectAlbum, playTrackAt, playByKey, togglePlay, playNext, playPrev,
    toggleShuffle, toggleRepeat, seek, setVolume,
    createAlbum, deleteAlbum, renameAlbum, uploadTrack, deleteTrack, moveTrack, renameTrack
  }
}
