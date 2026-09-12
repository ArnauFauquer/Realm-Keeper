// Recognizes inline-code spans that reference a track in the music player,
// e.g. `Action/01 Beyond Distant Lands.mp3`, mirroring the shape of track
// keys returned by the backend (storage_service.list_tracks: "{album}/{filename}").
const AUDIO_EXTENSIONS = ['mp3', 'ogg', 'oga', 'wav', 'flac', 'm4a', 'opus', 'aac', 'webm']
const SONG_KEY_RE = new RegExp(`^([^/\\n]+)/([^/\\n]+\\.(?:${AUDIO_EXTENSIONS.join('|')}))$`, 'i')

/** Parses "Album/filename.mp3" into its parts, or returns null if the text
 * isn't a track key (used by both the note renderer and the player). */
export function parseSongKey(text) {
  const match = SONG_KEY_RE.exec(text.trim())
  if (!match) return null
  return { key: match[0], album: match[1], filename: match[2] }
}
