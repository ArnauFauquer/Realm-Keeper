"""The audio player's albums and tracks, kept under `player/` in the store
(the bucket or the local folder, services/doc_backend.py):

    player/<album>/<track>

A track's key, as the player and the notes see it, is "<album>/<track>"; the
`player/` in front of it is where it is stored, nobody else's business. An
empty album is kept by a `.keep` file in it."""
import re
from typing import BinaryIO, Iterator, List, Optional, Tuple

from services.doc_backend import DocBackend
from services.storage_service import (
    ALLOWED_AUDIO_EXTENSIONS, AUDIO_CONTENT_TYPES, PLAYER_PREFIX, StorageError, _extension, _sanitize_segment,
)

KEEP = ".keep"
_RANGE_RE = re.compile(r"bytes=(\d*)-(\d*)$")


class RangeNotSatisfiable(StorageError):
    """A Range header asking for bytes the track doesn't have (416)."""


def _split_key(key: str) -> Tuple[str, str]:
    """A track's key, "<album>/<file>", as its album and file name."""
    parts = (key or "").split("/")
    if len(parts) != 2:
        raise StorageError(f"Invalid track key: {key!r}")
    return _sanitize_segment(parts[0]), _sanitize_segment(parts[1])


def _track_key(album: str, filename: str) -> str:
    """Where a track is stored. Whatever a track's key says, it can only name
    something under `player/`: nothing else in the store is reachable by it."""
    return f"{PLAYER_PREFIX}{album}/{filename}"


def _audio_name(name: str) -> str:
    name = _sanitize_segment(name)
    ext = _extension(name)
    if ext not in ALLOWED_AUDIO_EXTENSIONS:
        raise StorageError(f"Unsupported audio file type: {ext or name}")
    return name


def parse_range(header: Optional[str], size: int) -> Optional[Tuple[int, int]]:
    """The first and last byte a Range header asks for, or None for the whole
    file (no header, or one this doesn't read: several ranges, other units —
    which a server may answer with the whole file). Raises RangeNotSatisfiable
    for a range that starts past the end."""
    match = _RANGE_RE.match((header or "").strip())
    if not match or match.groups() == ("", ""):
        return None
    first, last = match.groups()
    if not first:   # "bytes=-500": the last 500
        start, end = max(size - int(last), 0), size - 1
    else:
        start = int(first)
        end = min(int(last), size - 1) if last else size - 1
        if last and int(last) < start:
            return None
    if start >= size or size == 0:
        raise RangeNotSatisfiable(f"bytes */{size}")
    return start, end


class PlayerLibrary:
    def __init__(self, store: DocBackend):
        self.store = store

    def list_albums(self) -> List[str]:
        albums = {key[len(PLAYER_PREFIX):].split("/", 1)[0] for key in self.store.list_keys(PLAYER_PREFIX)}
        return sorted((a for a in albums if a), key=str.lower)

    def create_album(self, name: str) -> None:
        name = _sanitize_segment(name)
        self.store.put(f"{PLAYER_PREFIX}{name}/{KEEP}", "")

    def rename_album(self, old_name: str, new_name: str) -> None:
        old_name, new_name = _sanitize_segment(old_name), _sanitize_segment(new_name)
        if old_name == new_name:
            return
        old_prefix, new_prefix = f"{PLAYER_PREFIX}{old_name}/", f"{PLAYER_PREFIX}{new_name}/"
        if self.store.list_keys(new_prefix):
            raise StorageError(f"An album named '{new_name}' already exists")
        if not self.store.list_keys(old_prefix):
            raise StorageError(f"Album not found: {old_name}")
        self.store.move_prefix(old_prefix, new_prefix)

    def delete_album(self, name: str) -> None:
        self.store.delete_prefix(f"{PLAYER_PREFIX}{_sanitize_segment(name)}/")

    def list_tracks(self, album: str) -> List[dict]:
        album = _sanitize_segment(album)
        prefix = f"{PLAYER_PREFIX}{album}/"
        tracks = [
            {
                "key": f"{album}/{f.key[len(prefix):]}",
                "name": f.key[len(prefix):],
                "size": f.size,
                "last_modified": f.modified.isoformat(),
            }
            # Only the album's own files: nothing deeper is a track.
            for f in self.store.list_files(prefix)
            if f.key[len(prefix):] not in ("", KEEP) and "/" not in f.key[len(prefix):]
        ]
        tracks.sort(key=lambda t: t["name"].lower())
        return tracks

    def upload_track(self, album: str, filename: str, file_obj: BinaryIO) -> dict:
        album, filename = _sanitize_segment(album), _audio_name(filename)
        self.store.put_file(_track_key(album, filename), file_obj, AUDIO_CONTENT_TYPES[_extension(filename)])
        return {"key": f"{album}/{filename}", "name": filename}

    def delete_track(self, key: str) -> None:
        self.store.delete(_track_key(*_split_key(key)))

    def _move(self, old_key: str, new_key: str, taken: str) -> None:
        if old_key == new_key:
            return
        if self.store.exists(new_key):
            raise StorageError(taken)
        if not self.store.exists(old_key):
            raise StorageError("Track not found")
        self.store.move(old_key, new_key)

    def rename_track(self, key: str, new_name: str) -> dict:
        """Renames a track, keeping it in its album."""
        album, filename = _split_key(key)
        new_name = _audio_name(new_name)
        self._move(_track_key(album, filename), _track_key(album, new_name),
                   f"A track named '{new_name}' already exists in {album}")
        return {"key": f"{album}/{new_name}", "name": new_name}

    def move_track(self, key: str, dest_album: str) -> dict:
        """Moves a track into `dest_album`, keeping its name (drag and drop
        between albums in the player)."""
        album, filename = _split_key(key)
        dest_album = _sanitize_segment(dest_album)
        self._move(_track_key(album, filename), _track_key(dest_album, filename),
                   f"{dest_album} already has a track named '{filename}'")
        return {"key": f"{dest_album}/{filename}"}

    def open_track(self, key: str, range_header: Optional[str] = None) -> Optional[dict]:
        """A track's bytes, for streaming: the whole of it, or the part a
        Range header asks for (`content_range` then says which). None if
        there is no such track."""
        stored = _track_key(*_split_key(key))
        size = self.store.size(stored)
        if size is None:
            return None
        wanted = parse_range(range_header, size)
        if wanted is None:
            opened = self.store.open(stored)
            if opened is None:
                return None
            return {"chunks": opened[0], "length": opened[1], "content_range": None}
        start, end = wanted
        chunks: Optional[Iterator[bytes]] = self.store.open_range(stored, start, end)
        if chunks is None:
            return None
        return {"chunks": chunks, "length": end - start + 1, "content_range": f"bytes {start}-{end}/{size}"}
