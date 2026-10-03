"""The documents of one DocType, in folders, over a DocBackend: list a level of
the tree, create with a unique slug, save, rename, move, delete, and the same
for folders. Written once for charts, vistas, encounters and battlemaps.

A document is a folder named by its slug that holds one JSON file:
    <prefix>/<folders...>/<slug>/<item_filename>
where <prefix> is the kind's own top-level prefix in the bucket ("charts",
"encounters"...). Folders are just the directories above it; an empty one is
kept by a ".keep" marker. Raises ValueError for anything the caller got wrong (DocNotFound for a
missing one) and lets storage errors through.
"""
import json
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ValidationError

from services.doc_backend import DocBackend
from services.doc_paths import sanitize_folder_name, sanitize_folder_path, sanitize_id, slugify
from services.doc_type import DocType, validate_library_urls

logger = logging.getLogger(__name__)

FOLDER_MARKER = ".keep"
LEGACY_FOLDER_MARKER = ".gitkeep"       # what the vault used to keep an empty folder with
LEGACY_MARKER = ".imported-from-vault"  # in a kind's prefix: its vault documents were copied
# "assets" and "folders" are fixed routes under every resource: a document or
# folder at the top level with one of those names would be unreachable.
RESERVED_TOP_SEGMENTS = {"assets", "folders"}


class DocNotFound(ValueError):
    pass


def _first_error(e: ValidationError) -> str:
    error = e.errors()[0]
    where = ".".join(str(part) for part in error["loc"])
    return f"{where}: {error['msg']}" if where else error["msg"]


class DocCollection:
    def __init__(self, doctype: DocType, backend: DocBackend):
        self.doctype = doctype
        self.backend = backend
        self.root = f"{doctype.prefix}/"

    # ── keys ────────────────────────────────────────────────────────────

    def _item_prefix(self, doc_id: str) -> str:
        return f"{self.root}{sanitize_id(doc_id)}/"

    def _item_key(self, doc_id: str) -> str:
        return f"{self._item_prefix(doc_id)}{self.doctype.item_filename}"

    def _check_not_reserved(self, doc_id: str) -> None:
        top, _, _ = doc_id.partition("/")
        if top in RESERVED_TOP_SEGMENTS:
            raise ValueError(f"'{top}' is a reserved name at the top level")
        leaf = doc_id.rsplit("/", 1)[-1]
        if leaf in self.doctype.reserved_names:
            raise ValueError(f"'{leaf}' is a reserved name")

    # ── reading ─────────────────────────────────────────────────────────

    def read_raw(self, doc_id: str) -> Optional[Dict[str, Any]]:
        text = self.backend.get(self._item_key(doc_id))
        if text is None:
            return None
        raw = json.loads(text)
        # Where the document is stored is authoritative: a folder rename or a
        # move leaves the id written in the file stale.
        raw["id"] = sanitize_id(doc_id)
        return raw

    def get(self, doc_id: str) -> Optional[BaseModel]:
        try:
            raw = self.read_raw(doc_id)
        except ValueError:
            return None
        return self.doctype.model.model_validate(raw) if raw is not None else None

    def _metadata(self, doc_id: str) -> Optional[BaseModel]:
        try:
            raw = self.read_raw(doc_id)
            return self.doctype.metadata_model.model_validate(raw) if raw is not None else None
        except Exception as e:
            logger.error(f"Error reading {self.doctype.kind} {doc_id}: {e}")
            return None

    def _item_ids(self, keys: List[str]) -> List[str]:
        """Ids of every document among `keys` (full backend keys)."""
        suffix = f"/{self.doctype.item_filename}"
        return sorted(key[len(self.root):-len(suffix)] for key in keys if key.endswith(suffix))

    def _read_metadata(self, ids: List[str]) -> List[BaseModel]:
        with ThreadPoolExecutor(max_workers=8) as pool:
            found = [m for m in pool.map(self._metadata, ids) if m is not None]
        found.sort(key=lambda m: (m.name or "").lower())
        return found

    def list_tree(self, path: str = "") -> Dict[str, Any]:
        """The folders and documents directly under `path` (not recursive)."""
        path = sanitize_folder_path(path)
        base = f"{path}/" if path else ""
        suffix = self.doctype.item_filename
        direct, folders = set(), set()
        relatives = [key[len(self.root + base):] for key in self.backend.list_keys(self.root + base)]
        for rel in relatives:
            name, _, rest = rel.partition("/")
            if rest == suffix:
                direct.add(name)
        for rel in relatives:
            name, _, rest = rel.partition("/")
            if rest and name not in direct:
                folders.add(name)
        items = self._read_metadata([f"{base}{name}" for name in sorted(direct)])
        return {"folders": sorted(folders, key=str.lower), self.doctype.items_key: items}

    def list_all(self) -> List[BaseModel]:
        """Every document, at any depth."""
        return self._read_metadata(self._item_ids(self.backend.list_keys(self.root)))

    # ── writing ─────────────────────────────────────────────────────────

    def write_raw(self, doc_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """Stores `data`, stamped with the time. Returns what was stored."""
        data = {**data, "updated_at": datetime.now(timezone.utc).isoformat()}
        self.backend.put(self._item_key(doc_id), json.dumps(data, indent=2, ensure_ascii=False))
        return data

    def _validated(self, data: Dict[str, Any]) -> Dict[str, Any]:
        try:
            model = self.doctype.model.model_validate(data)
        except ValidationError as e:
            raise ValueError(_first_error(e))
        validated = model.model_dump(mode="json")
        validate_library_urls(validated, self.doctype)
        return validated

    def _unique_slug(self, base_slug: str, folder_path: str) -> str:
        """`base_slug`, or the first "<slug>-2", "-3"... that is free. A name
        that would read as one of the kind's routes ("Image") is not free."""
        base = f"{folder_path}/" if folder_path else ""
        slug, suffix = base_slug, 2
        while slug in self.doctype.reserved_names or self.backend.exists(
            f"{self.root}{base}{slug}/{self.doctype.item_filename}"
        ):
            slug = f"{base_slug}-{suffix}"
            suffix += 1
        return slug

    def create(self, name: str, description: Optional[str] = None, folder_path: str = "") -> BaseModel:
        name = (name or "").strip()
        if not name:
            raise ValueError("A name is required")
        folder_path = sanitize_folder_path(folder_path)
        slug = self._unique_slug(slugify(name, self.doctype.kind), folder_path)
        doc_id = f"{folder_path}/{slug}" if folder_path else slug
        self._check_not_reserved(doc_id)
        data = self._validated({"id": doc_id, "name": name, "description": description})
        return self.doctype.model.model_validate(self.write_raw(doc_id, data))

    def _require(self, doc_id: str) -> Dict[str, Any]:
        raw = self.read_raw(doc_id)
        if raw is None:
            raise DocNotFound(f"{self.doctype.kind.capitalize()} not found: {doc_id}")
        return raw

    def save(self, doc_id: str, fields: Dict[str, Any]) -> BaseModel:
        """Replaces a document with `fields`, keeping its locked fields."""
        existing = self._require(doc_id)
        data = {**fields, "id": existing["id"]}
        for name in self.doctype.locked_fields:
            data[name] = existing.get(name)
        data = self._validated(data)
        return self.doctype.model.model_validate(self.write_raw(doc_id, data))

    def set_field(self, doc_id: str, field_name: str, value: Any) -> BaseModel:
        existing = self._require(doc_id)
        data = self._validated({**existing, field_name: value})
        return self.doctype.model.model_validate(self.write_raw(doc_id, data))

    def rename(self, doc_id: str, name: str) -> BaseModel:
        name = (name or "").strip()
        if not name:
            raise ValueError("A name is required")
        return self.set_field(doc_id, "name", name)

    def delete(self, doc_id: str) -> None:
        self._require(doc_id)
        self.backend.delete_prefix(self._item_prefix(doc_id))

    def move_item(self, doc_id: str, dest_folder_path: str) -> str:
        """Moves a document into `dest_folder_path`, keeping its own slug.
        Returns its new id."""
        doc_id = sanitize_id(doc_id)
        self._require(doc_id)
        dest = sanitize_folder_path(dest_folder_path)
        new_id = f"{dest}/{doc_id.rsplit('/', 1)[-1]}" if dest else doc_id.rsplit("/", 1)[-1]
        if new_id == doc_id:
            return doc_id
        self._check_not_reserved(new_id)
        self.backend.move_prefix(self._item_prefix(doc_id), self._item_prefix(new_id))
        return new_id

    # ── what the vault (git) used to hold ───────────────────────────────

    def import_legacy(self, vault_path: Path) -> int:
        """Copies the documents (and empty folders) of `doctype.legacy_dir` in
        the vault into the store, once. Returns how many documents it copied.

        Non-destructive: nothing is changed or removed in the vault, and a
        document already in the store is left as it is. Once means once: it
        leaves a marker, so a document deleted afterwards isn't brought back by
        the next start. Without the marker (a failed first try) the next start
        tries again, and only copies what is still missing."""
        legacy = self.doctype.legacy_dir
        # No such directory (a kind that was never in the vault, a vault without
        # any, or one that was cleaned up): nothing to copy, and no marker, so
        # nothing is decided for good.
        root = Path(vault_path) / legacy if legacy else None
        if root is None or not root.is_dir():
            return 0
        marker = f"{self.root}{LEGACY_MARKER}"
        if self.backend.exists(marker):
            return 0

        copied = 0
        for file in sorted(root.rglob("*")):
            if not file.is_file():
                continue
            folder = file.parent.relative_to(root).as_posix()
            folder = "" if folder == "." else folder
            try:
                if file.name == self.doctype.item_filename:
                    copied += self._import_legacy_file(file, sanitize_id(folder))
                elif file.name == LEGACY_FOLDER_MARKER and folder:
                    key = f"{self.root}{sanitize_folder_path(folder)}/{FOLDER_MARKER}"
                    if not self.backend.exists(key):
                        self.backend.put(key, "")
            except ValueError as e:
                logger.warning(f"Skipped {file} while importing {self.doctype.prefix}: {e}")
        self.backend.put(marker, json.dumps({
            "imported_at": datetime.now(timezone.utc).isoformat(), "documents": copied,
        }))
        if copied:
            logger.info(f"Imported {copied} {self.doctype.prefix} from the vault's {legacy}/")
        return copied

    def _import_legacy_file(self, file: Path, doc_id: str) -> int:
        key = self._item_key(doc_id)
        if self.backend.exists(key):
            return 0
        text = file.read_text(encoding="utf-8")
        json.loads(text)  # a document that can't be read here couldn't be read later either
        self.backend.put(key, text)
        return 1

    # ── folders ─────────────────────────────────────────────────────────

    def create_folder(self, path: str) -> None:
        path = sanitize_folder_path(path)
        if not path:
            raise ValueError("Folder path is required")
        self._check_not_reserved(path)
        if self.backend.list_keys(f"{self.root}{path}/"):
            raise ValueError(f"A folder or {self.doctype.kind} already exists at '{path}'")
        self.backend.put(f"{self.root}{path}/{FOLDER_MARKER}", "")

    def move_folder(
        self, path: str, new_parent_path: Optional[str] = None, new_name: Optional[str] = None,
    ) -> None:
        """Renames and/or reparents the folder at `path`. Only `new_name`
        renames it in place; only `new_parent_path` moves it under another
        parent keeping its name."""
        path = sanitize_folder_path(path)
        if not path:
            raise ValueError("Folder path is required")
        parent, _, leaf = path.rpartition("/")
        dest_parent = sanitize_folder_path(new_parent_path) if new_parent_path is not None else parent
        dest_name = sanitize_folder_name(new_name) if new_name is not None else leaf
        new_path = f"{dest_parent}/{dest_name}" if dest_parent else dest_name
        if new_path == path:
            return
        if new_path == dest_parent or new_path.startswith(f"{path}/"):
            raise ValueError("Cannot move a folder into itself or one of its own subfolders")
        self._check_not_reserved(new_path)
        self.backend.move_prefix(f"{self.root}{path}/", f"{self.root}{new_path}/")

    def delete_folder(self, path: str) -> List[str]:
        """Deletes a folder with everything in it. Returns the ids of the
        documents that were inside."""
        path = sanitize_folder_path(path)
        if not path:
            raise ValueError("Folder path is required")
        keys = self.backend.list_keys(f"{self.root}{path}/")
        if not keys:
            raise ValueError(f"Folder not found: {path}")
        self.backend.delete_prefix(f"{self.root}{path}/")
        return self._item_ids(keys)
