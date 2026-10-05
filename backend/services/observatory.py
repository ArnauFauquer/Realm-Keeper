"""The Observatory: one tree of folders that holds every document and every
image the documents draw, as files.

    observatory/<folders>/<slug>.<kind>.json    a document (services/doc_collection.py)
    observatory/<folders>/<uid>-<name>.<ext>    an image
    observatory/<folders>/.keep                 what keeps an empty folder

so an adventure's map, its chart, its vistas and its encounters can share a
folder. Here are the folders (listing one, creating, renaming, moving and
deleting them), the images, and a backup of the whole tree (or a folder of it)
as a zip with the same layout.

An image is served at /api/observatory/images/<uid>-<name> and found by its
uid alone (eight hex digits, given at upload): renaming an image keeps its uid
and moving it keeps its name, so neither breaks the documents and notes that
show it. Which file holds which uid is an index kept in memory and rebuilt
from the store when asked for one it doesn't know (another process, a restore).

Raises ValueError for anything the caller got wrong (DocNotFound for a missing
one) and lets storage errors through.
"""
import json
import logging
import re
import threading
import time
import uuid
import zipfile
from typing import Any, BinaryIO, Dict, Iterator, List, Optional, Tuple
from urllib.parse import quote

from services.doc_backend import DocBackend, DocBackendError
from services.doc_collection import FOLDER_MARKER, DocCollection, DocNotFound
from services.doc_paths import sanitize_folder_name, sanitize_folder_path
from services.storage_service import ALLOWED_IMAGE_EXTENSIONS, IMAGE_CONTENT_TYPES, IMAGE_URL_PREFIX, OBSERVATORY_PREFIX

logger = logging.getLogger(__name__)

IMAGE_KIND = "image"
_UID_RE = re.compile(r"^([0-9a-f]{8})-(.+)$")
# How soon the index may be read from the store again for an image it doesn't
# know: a page asking for a missing image over and over mustn't list the bucket
# every time.
INDEX_REFRESH_INTERVAL = 2.0
# What a restore takes at most: a zip that says it holds more is refused before
# anything is read from it.
MAX_IMPORT_FILES = 20_000
MAX_IMPORT_BYTES = 4 * 1024 ** 3


def _extension(filename: str) -> str:
    return filename[filename.rfind("."):].lower() if "." in filename else ""


def is_image_name(filename: str) -> bool:
    return _extension(filename) in ALLOWED_IMAGE_EXTENSIONS


def image_uid(filename: str) -> Optional[str]:
    """The uid an image file name ("1a2b3c4d-cave.png") starts with, if any."""
    match = _UID_RE.match(filename or "")
    return match.group(1) if match else None


def image_display_name(filename: str) -> str:
    """The name the image was uploaded with: its file name without the uid."""
    match = _UID_RE.match(filename)
    return match.group(2) if match else filename


def image_url(filename: str) -> str:
    """Where the app serves an image ("/api/observatory/images/1a2b3c4d-cave%20map.png"),
    quoted so it can be pasted as is into a note's markdown."""
    return f"{IMAGE_URL_PREFIX}{quote(filename, safe='')}"


def _check_image_name(name: str) -> str:
    name = sanitize_folder_name(name)
    if not is_image_name(name):
        raise ValueError(f"Unsupported image file type: {_extension(name) or name}")
    return name


class Observatory:
    def __init__(self, backend: DocBackend, collections: Dict[str, DocCollection], root: str = OBSERVATORY_PREFIX):
        self.backend = backend
        self.collections = collections
        self.root = root
        self._index: Dict[str, str] = {}   # uid -> key
        self._index_read_at: Optional[float] = None
        self._index_lock = threading.Lock()

    # ── paths ───────────────────────────────────────────────────────────

    def _prefix(self, path: str) -> str:
        """The key prefix of the folder at `path` ("" is the top)."""
        path = sanitize_folder_path(path)
        return f"{self.root}{path}/" if path else self.root

    def _kind_of(self, filename: str) -> Optional[str]:
        """What a file in the tree is, by its name: a document's kind, "image",
        or None for anything else (a folder marker, a stray file)."""
        if filename.startswith("."):
            return None
        for kind, collection in self.collections.items():
            suffix = collection.doctype.suffix
            if filename.endswith(suffix) and len(filename) > len(suffix):
                return kind
        return IMAGE_KIND if is_image_name(filename) else None

    # ── listing ─────────────────────────────────────────────────────────

    def list(self, path: str = "") -> Dict[str, Any]:
        """The folders and files directly in the folder at `path`: every
        document, each with its `kind`, and every image."""
        base = self._prefix(path)
        folders, doc_ids, images = set(), {kind: [] for kind in self.collections}, []
        for key in self.backend.list_keys(base):
            name, sep, _rest = key[len(base):].partition("/")
            if sep:
                folders.add(name)
                continue
            kind = self._kind_of(name)
            if kind == IMAGE_KIND:
                images.append(self._image_item(key))
            elif kind:
                doc_ids[kind].append(key[len(self.root):-len(self.collections[kind].doctype.suffix)])
        items = [
            {**meta.model_dump(mode="json"), "kind": kind}
            for kind, ids in doc_ids.items() if ids
            for meta in self.collections[kind].read_metadata(ids)
        ]
        items.extend(images)
        items.sort(key=lambda item: ((item.get("name") or "").lower(), item["kind"]))
        return {"folders": sorted(folders, key=str.lower), "items": items}

    def ids_under(self, path: str) -> Dict[str, List[str]]:
        """The ids of every document inside the folder at `path`, at any depth, by kind."""
        keys = self.backend.list_keys(self._prefix(path))
        return {kind: collection.ids(keys) for kind, collection in self.collections.items()}

    # ── folders ─────────────────────────────────────────────────────────

    def create_folder(self, path: str) -> None:
        path = sanitize_folder_path(path)
        if not path:
            raise ValueError("Folder path is required")
        if self.backend.list_keys(f"{self.root}{path}/"):
            raise ValueError(f"A folder already exists at '{path}'")
        self.backend.put(f"{self.root}{path}/{FOLDER_MARKER}", "")

    @staticmethod
    def folder_destination(path: str, new_parent_path: Optional[str] = None, new_name: Optional[str] = None) -> str:
        """Where the folder at `path` ends up, moved under `new_parent_path`
        and/or renamed to `new_name` (either left out stays as it is)."""
        path = sanitize_folder_path(path)
        if not path:
            raise ValueError("Folder path is required")
        parent, _, leaf = path.rpartition("/")
        dest_parent = sanitize_folder_path(new_parent_path) if new_parent_path is not None else parent
        dest_name = sanitize_folder_name(new_name) if new_name is not None else leaf
        new_path = f"{dest_parent}/{dest_name}" if dest_parent else dest_name
        if new_path != path and (new_path == dest_parent or new_path.startswith(f"{path}/")):
            raise ValueError("Cannot move a folder into itself or one of its own subfolders")
        return new_path

    def move_folder(
        self, path: str, new_parent_path: Optional[str] = None, new_name: Optional[str] = None,
    ) -> Dict[str, Dict[str, str]]:
        """Renames and/or reparents the folder at `path`, with everything in
        it. Returns the documents that got a new id: {kind: {old id: new id}}."""
        path = sanitize_folder_path(path)
        new_path = self.folder_destination(path, new_parent_path, new_name)
        if new_path == path:
            return {}
        inside = self.ids_under(path)
        try:
            self.backend.move_prefix(f"{self.root}{path}/", f"{self.root}{new_path}/")
        except DocBackendError as e:
            raise ValueError(f"Cannot move '{path}' to '{new_path}': {e}")
        finally:
            self._forget_index()
        return {
            kind: {doc_id: f"{new_path}{doc_id[len(path):]}" for doc_id in ids}
            for kind, ids in inside.items() if ids
        }

    def delete_folder(self, path: str) -> Dict[str, List[str]]:
        """Deletes a folder with everything in it. Returns the ids of the
        documents that were inside, by kind."""
        path = sanitize_folder_path(path)
        if not path:
            raise ValueError("Folder path is required")
        keys = self.backend.list_keys(f"{self.root}{path}/")
        if not keys:
            raise DocNotFound(f"Folder not found: {path}")
        self.backend.delete_prefix(f"{self.root}{path}/")
        self._forget_index()
        return {kind: ids for kind, collection in self.collections.items() if (ids := collection.ids(keys))}

    # ── images ──────────────────────────────────────────────────────────

    def _forget_index(self) -> None:
        with self._index_lock:
            self._index_read_at = None

    def _read_index(self) -> None:
        index = {}
        for key in self.backend.list_keys(self.root):
            uid = image_uid(key.rsplit("/", 1)[-1])
            if uid and is_image_name(key):
                index.setdefault(uid, key)
        self._index, self._index_read_at = index, time.monotonic()

    def _key_of(self, uid: str, refresh: bool = False) -> Optional[str]:
        """Where the image with `uid` is. Reads the index from the store if it
        hasn't been, and with `refresh` (an image it doesn't know) again if it
        hasn't just been."""
        with self._index_lock:
            stale = self._index_read_at is None or (
                refresh and time.monotonic() - self._index_read_at > INDEX_REFRESH_INTERVAL
            )
            if stale:
                self._read_index()
            return self._index.get(uid)

    def image_key(self, filename: str) -> Optional[str]:
        """Where the image a file name or URL name ("1a2b3c4d-cave.png") stands
        for is stored, found by its uid; None if there is no such image."""
        uid = image_uid(filename)
        if not uid:
            return None
        return self._key_of(uid) or self._key_of(uid, refresh=True)

    def _require_image(self, filename: str) -> str:
        key = self.image_key(filename)
        if key is None:
            raise DocNotFound(f"Image not found: {filename}")
        return key

    def _image_item(self, key: str) -> Dict[str, Any]:
        filename = key.rsplit("/", 1)[-1]
        return {
            "kind": IMAGE_KIND, "id": filename, "name": image_display_name(filename),
            "url": image_url(filename), "folder": key[len(self.root):].rpartition("/")[0],
        }

    def _new_uid(self) -> str:
        while True:
            uid = uuid.uuid4().hex[:8]
            if self._key_of(uid) is None:
                return uid

    def upload_image(self, folder_path: str, filename: str, file_obj: BinaryIO) -> Dict[str, Any]:
        """Stores an uploaded image in the folder at `folder_path`. Every upload
        gets a uid of its own, even one with the name of an image already
        there: a URL never starts showing other pixels (browsers keep images
        for good, see config/cache.py)."""
        filename = _check_image_name(filename)
        key = f"{self._prefix(folder_path)}{self._new_uid()}-{filename}"
        self.backend.put_file(key, file_obj, IMAGE_CONTENT_TYPES[_extension(filename)])
        self._remember(key)
        return self._image_item(key)

    def _remember(self, key: str) -> None:
        with self._index_lock:
            self._index[image_uid(key.rsplit("/", 1)[-1])] = key

    def _drop(self, key: str) -> None:
        with self._index_lock:
            self._index.pop(image_uid(key.rsplit("/", 1)[-1]), None)

    def rename_image(self, filename: str, new_name: str) -> Dict[str, Any]:
        """Renames an image, keeping its uid (so what shows it still does) and its folder."""
        key = self._require_image(filename)
        new_name = _check_image_name(new_name)
        uid = image_uid(key.rsplit("/", 1)[-1])
        new_key = f"{key.rpartition('/')[0]}/{uid}-{new_name}"
        if new_key != key:
            self.backend.move(key, new_key)
            self._remember(new_key)
        return self._image_item(new_key)

    def move_image(self, filename: str, dest_folder_path: str) -> Dict[str, Any]:
        key = self._require_image(filename)
        new_key = f"{self._prefix(dest_folder_path)}{key.rsplit('/', 1)[-1]}"
        if new_key != key:
            self.backend.move(key, new_key)
            self._remember(new_key)
        return self._image_item(new_key)

    def delete_image(self, filename: str) -> None:
        key = self._require_image(filename)
        self.backend.delete(key)
        self._drop(key)

    def open_image(self, filename: str) -> Tuple[Iterator[bytes], int, str]:
        """The image's bytes (in chunks), their number and its Content-Type,
        which comes from its extension, never from whoever uploaded it."""
        key = self._require_image(filename)
        opened = self.backend.open(key)
        if opened is None:
            self._forget_index()
            raise DocNotFound(f"Image not found: {filename}")
        chunks, length = opened
        return chunks, length, IMAGE_CONTENT_TYPES[_extension(key)]

    # ── backup ──────────────────────────────────────────────────────────

    def export_zip(self, out: BinaryIO, path: str = "") -> int:
        """Writes a zip of the folder at `path` (the whole tree by default) to
        `out`, laid out as in the store and named from the top of the tree:
        restoring it puts every file back where it was. Returns how many files
        it holds."""
        base = self._prefix(path)
        count = 0
        with zipfile.ZipFile(out, "w") as archive:
            for key in self.backend.list_keys(base):
                name = key[len(self.root):]
                filename = name.rsplit("/", 1)[-1]
                kind = self._kind_of(filename)
                if kind is None and filename != FOLDER_MARKER:
                    continue   # the top level's import markers, stray files
                opened = self.backend.open(key)
                if opened is None:
                    continue
                chunks, _length = opened
                info = zipfile.ZipInfo(name, date_time=time.localtime()[:6])
                # Images are compressed already.
                info.compress_type = zipfile.ZIP_STORED if kind == IMAGE_KIND else zipfile.ZIP_DEFLATED
                with archive.open(info, "w") as entry:
                    for chunk in chunks:
                        entry.write(chunk)
                count += 1
        return count

    def import_zip(self, file_obj: BinaryIO) -> Dict[str, Any]:
        """Restores a backup made by export_zip: every document, image and
        folder goes back where it was. Nothing already there is replaced; what
        is skipped, and why, is in the answer: {"restored": n, "skipped": [{path, reason}]}."""
        try:
            archive = zipfile.ZipFile(file_obj)
        except zipfile.BadZipFile:
            raise ValueError("That is not a zip file")
        with archive:
            entries = [info for info in archive.infolist() if not info.is_dir()]
            if len(entries) > MAX_IMPORT_FILES:
                raise ValueError(f"A backup may hold {MAX_IMPORT_FILES} files at most")
            if sum(info.file_size for info in entries) > MAX_IMPORT_BYTES:
                raise ValueError(f"A backup may hold {MAX_IMPORT_BYTES // 1024 ** 3} GiB at most")
            self._forget_index()   # which uids are taken, as the store says now
            restored, skipped = 0, []
            for info in entries:
                try:
                    if self._restore(archive, info):
                        restored += 1
                    else:
                        skipped.append({"path": info.filename, "reason": "already there"})
                except (ValueError, KeyError, UnicodeDecodeError) as e:
                    skipped.append({"path": info.filename, "reason": str(e)})
        self._forget_index()
        return {"restored": restored, "skipped": skipped}

    def _restore(self, archive: zipfile.ZipFile, info: zipfile.ZipInfo) -> bool:
        folder, _, filename = info.filename.replace("\\", "/").strip("/").rpartition("/")
        folder = sanitize_folder_path(folder)
        if filename == FOLDER_MARKER:
            if not folder:
                raise ValueError("not in a folder")
            key = f"{self.root}{folder}/{FOLDER_MARKER}"
            if self.backend.exists(key):
                return False
            self.backend.put(key, "")
            return True
        filename = sanitize_folder_name(filename)
        kind = self._kind_of(filename)
        if kind is None:
            raise ValueError("not a document or an image")
        if kind == IMAGE_KIND:
            return self._restore_image(archive, info, folder, filename)
        collection = self.collections[kind]
        slug = filename[:-len(collection.doctype.suffix)]
        doc_id = f"{folder}/{slug}" if folder else slug
        data = json.loads(archive.read(info).decode("utf-8"))
        if not isinstance(data, dict):
            raise ValueError("not a document")
        return collection.restore(doc_id, data)

    def _restore_image(self, archive: zipfile.ZipFile, info: zipfile.ZipInfo, folder: str, filename: str) -> bool:
        uid = image_uid(filename)
        if uid is None:
            # Added to the backup by hand: it gets a uid, like an upload.
            filename = f"{self._new_uid()}-{filename}"
        key = f"{self._prefix(folder)}{filename}"
        existing = self._key_of(uid) if uid else None
        if existing == key:
            return False
        if existing:
            raise ValueError(f"an image with the same id is at {existing[len(self.root):]}")
        with archive.open(info) as data:
            self.backend.put_file(key, data, IMAGE_CONTENT_TYPES[_extension(filename)])
        self._remember(key)
        return True
