import { computed, reactive, ref } from 'vue'
import { streamUrl } from '@/api/player'

// Sound effects: short tracks from the player's albums (a door, a neigh, a
// scream) played on top of the music instead of replacing it. Each effect
// gets its own <audio>, so several can overlap and none touches the music
// player's element. Module-level like usePlayer, so an effect keeps going
// when the note that launched it is left.

const VOLUME_KEY = 'rk-sfx-volume'

function storedVolume() {
  try {
    const v = parseFloat(localStorage.getItem(VOLUME_KEY))
    return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 1
  } catch {
    return 1
  }
}

const volume = ref(storedVolume())

// key -> { name, progress (0..1) } for every effect sounding right now.
const playing = reactive({})
const audios = new Map()

const playingKeys = computed(() => Object.keys(playing))

function effectName(key) {
  return key.slice(key.indexOf('/') + 1).replace(/\.[^.]+$/, '')
}

function stop(key) {
  const audio = audios.get(key)
  if (audio) {
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
  }
  audios.delete(key)
  delete playing[key]
}

/**
 * Starts the effect, or stops it if it is already sounding: the same button
 * that lets a scream out cuts it short. Resolves once playback has begun and
 * rejects if the track can't be played (missing, unsupported).
 */
async function toggle(key) {
  if (audios.has(key)) {
    stop(key)
    return
  }
  const audio = new Audio(streamUrl(key))
  audio.volume = volume.value
  audios.set(key, audio)
  playing[key] = { name: effectName(key), progress: 0 }

  audio.addEventListener('timeupdate', () => {
    if (playing[key] && audio.duration) playing[key].progress = audio.currentTime / audio.duration
  })
  audio.addEventListener('ended', () => {
    if (audios.get(key) === audio) stop(key)
  })

  try {
    await audio.play()
  } catch (e) {
    if (audios.get(key) === audio) stop(key)
    throw e
  }
}

function stopAll() {
  for (const key of [...audios.keys()]) stop(key)
}

function setVolume(v) {
  volume.value = v
  for (const audio of audios.values()) audio.volume = v
  try {
    localStorage.setItem(VOLUME_KEY, String(v))
  } catch {
    // Private windows may refuse storage; the volume still applies now.
  }
}

export function useSoundEffects() {
  return { playing, playingKeys, volume, toggle, stop, stopAll, setVolume, effectName }
}
