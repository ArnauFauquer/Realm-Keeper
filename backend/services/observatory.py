"""The Observatory: one tree of folders that holds every document and every
image the documents draw, as files.

    observatory/<folders>/<slug>.<kind>.json    a document (services/doc_collection.py)
    observatory/<folders>/<uid>-<name>.<ext>    an image
    observatory/<folders>/.keep                 what keeps an empty folder

so an adventure's map, its chart, its vistas and its encounters can share a
folder. Here are the folders (listing one, creating, renaming, moving and
deleting them), the images, and moving files in and out: a folder exported as
a zip, and images, documents and zips imported into a folder.

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
import unicodedata
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
# What an imported zip may hold at most: one that says it holds more is refused
# before anything is read from it.
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


def _folded(text: str) -> str:
    """Lowercase, without accents: "Ciénaga" and "cienaga" are the same search."""
    decomposed = unicodedata.normalize("NFKD", str(text).lower())
    return "".join(c for c in decomposed if not unicodedata.combining(c))


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

    def list_kind(self, kind: str) -> Dict[str, Any]:
        """Everything of one kind ("chart"... or "image") wherever it is in the
        tree, by name: what a shortcut to a kind shows. Each item says its
        `folder`."""
        if kind == IMAGE_KIND:
            items = [self._image_item(key) for key in self.backend.list_keys(self.root)
                     if is_image_name(key) and image_uid(key.rsplit("/", 1)[-1])]
        elif kind in self.collections:
            items = [
                {**meta.model_dump(mode="json"), "kind": kind, "folder": meta.id.rpartition("/")[0]}
                for meta in self.collections[kind].list_all()
            ]
        else:
            raise ValueError(f"Unknown kind: {kind}")
        items.sort(key=lambda item: ((item.get("name") or "").lower(), item["folder"].lower()))
        return {"folders": [], "items": items}

    def search(self, query: str, limit: int = 40) -> List[Dict[str, Any]]:
        """Documents and images whose name, place, subtitle or tags hold every
        word of `query`, ignoring case and accents; names that start with it first."""
        words = _folded(query).split()
        if not words:
            return []
        found = []
        for kind in (*self.collections, IMAGE_KIND):
            for item in self.list_kind(kind)["items"]:
                name = _folded(item.get("name") or "")
                haystack = " ".join([name, _folded(item.get("id") or ""), _folded(item.get("subtitle") or ""),
                                     *(_folded(tag) for tag in item.get("tags") or [])])
                if all(word in haystack for word in words):
                    found.append((not name.startswith(words[0]), name, item))
        found.sort(key=lambda entry: entry[:2])
        return [item for _, _, item in found[:limit]]

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

    # ── export and import ───────────────────────────────────────────────

    def export_zip(self, out: BinaryIO, path: str = "") -> int:
        """Writes a zip of the folder at `path` (the whole tree by default) to
        `out`: its documents, images and subfolders, named from that folder, so
        importing it anywhere brings back the same files. Returns how many it holds."""
        base = self._prefix(path)
        count = 0
        with zipfile.ZipFile(out, "w") as archive:
            for key in self.backend.list_keys(base):
                name = key[len(base):]
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

    def import_files(self, folder_path: str, files: List[Tuple[str, BinaryIO]]) -> Dict[str, Any]:
        """Brings (file name, file) pairs into the folder at `folder_path`:
        images, documents (`<name>.<kind>.json`, as a document is exported) and
        zips of them (an export), whose own folders go inside it. Nothing
        already there is replaced: a document whose slug is taken gets the next
        free one, like a new document, and an image whose uid is taken a new
        uid. Returns {"items": [what was added], "skipped": [{path, reason}]}."""
        folder_path = sanitize_folder_path(folder_path)
        report: Dict[str, Any] = {"items": [], "skipped": []}
        self._forget_index()   # which uids are taken, as the store says now
        for filename, file_obj in files:
            if _extension(filename) == ".zip":
                self._import_zip(folder_path, filename, file_obj, report)
            else:
                self._import_one(folder_path, filename, lambda f=file_obj: f, report)
        return report

    def _import_zip(self, folder_path: str, filename: str, file_obj: BinaryIO, report: Dict[str, Any]) -> None:
        try:
            archive = zipfile.ZipFile(file_obj)
        except zipfile.BadZipFile:
            report["skipped"].append({"path": filename, "reason": "not a zip file"})
            return
        with archive:
            entries = [info for info in archive.infolist() if not info.is_dir()]
            if len(entries) > MAX_IMPORT_FILES:
                report["skipped"].append({"path": filename, "reason": f"a zip may hold {MAX_IMPORT_FILES} files at most"})
                return
            if sum(info.file_size for info in entries) > MAX_IMPORT_BYTES:
                report["skipped"].append({"path": filename, "reason": f"a zip may hold {MAX_IMPORT_BYTES // 1024 ** 3} GiB at most"})
                return
            for info in entries:
                inner, _, name = info.filename.replace("\\", "/").strip("/").rpartition("/")
                try:
                    inner = sanitize_folder_path(inner)
                except ValueError as e:
                    report["skipped"].append({"path": info.filename, "reason": str(e)})
                    continue
                folder = "/".join(part for part in (folder_path, inner) if part)
                self._import_one(folder, name, lambda i=info: archive.open(i), report, shown_as=info.filename)

    def _import_one(self, folder: str, filename: str, opener, report: Dict[str, Any], shown_as: Optional[str] = None) -> None:
        """Imports one file into `folder`; `opener()` gives its contents."""
        try:
            if filename == FOLDER_MARKER:
                if folder and not self.backend.list_keys(f"{self.root}{folder}/"):
                    self.backend.put(f"{self.root}{folder}/{FOLDER_MARKER}", "")
                return
            filename = sanitize_folder_name(filename)
            kind = self._kind_of(filename)
            if kind is None:
                raise ValueError("not an image or a document (name.chart.json, name.vista.json...)")
            if kind == IMAGE_KIND:
                report["items"].append(self._import_image(folder, filename, opener))
            else:
                report["items"].append(self._import_document(folder, filename, kind, opener))
        except (ValueError, KeyError, UnicodeDecodeError) as e:
            report["skipped"].append({"path": shown_as or filename, "reason": str(e)})

    def _import_image(self, folder: str, filename: str, opener) -> Dict[str, Any]:
        # An exported image keeps its uid where it is free, so the documents
        # that came with it still find it. Otherwise it gets a new one: a URL
        # never starts showing other pixels (browsers keep images for good, see
        # config/cache.py).
        uid = image_uid(filename)
        if uid is None or self._key_of(uid) is not None:
            filename = f"{self._new_uid()}-{image_display_name(filename)}"
        key = f"{self._prefix(folder)}{filename}"
        with opener() as data:
            self.backend.put_file(key, data, IMAGE_CONTENT_TYPES[_extension(filename)])
        self._remember(key)
        return self._image_item(key)

    def _import_document(self, folder: str, filename: str, kind: str, opener) -> Dict[str, Any]:
        collection = self.collections[kind]
        with opener() as data:
            document = json.loads(data.read().decode("utf-8"))
        if not isinstance(document, dict):
            raise ValueError(f"not a {kind}")
        added = collection.add(folder, filename[:-len(collection.doctype.suffix)], document)
        return {**collection.doctype.metadata_model.model_validate(added.model_dump()).model_dump(mode="json"), "kind": kind}
