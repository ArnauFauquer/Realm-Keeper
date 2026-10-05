"""The documents of one DocType: create with a unique slug, read, save, rename,
move and delete. Written once for every kind.

Every kind shares one tree of folders, the Observatory's (services/observatory.py),
which also holds the images; a document is one file in it:
    observatory/<folders...>/<slug>.<kind>.json
so a chart and an encounter of the same name can sit side by side. The folders
themselves (listing, creating, moving, deleting them) are the Observatory's.
Raises ValueError for anything the caller got wrong (DocNotFound for a missing
one) and lets storage errors through.
"""
import json
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ValidationError

from services.doc_backend import DocBackend
from services.doc_paths import sanitize_folder_path, sanitize_id, slugify
from services.doc_type import DocType, validate_library_urls
from services.storage_service import OBSERVATORY_PREFIX

logger = logging.getLogger(__name__)

FOLDER_MARKER = ".keep"
LEGACY_FOLDER_MARKER = ".gitkeep"   # what the vault used to keep an empty folder with


class DocNotFound(ValueError):
    pass


def _first_error(e: ValidationError) -> str:
    error = e.errors()[0]
    where = ".".join(str(part) for part in error["loc"])
    return f"{where}: {error['msg']}" if where else error["msg"]


class DocCollection:
    def __init__(self, doctype: DocType, backend: DocBackend, root: str = OBSERVATORY_PREFIX):
        self.doctype = doctype
        self.backend = backend
        self.root = root
        # In the tree's top level, where no folder can be: its vault documents were copied.
        self.legacy_marker = f"{root}.{doctype.prefix}-imported-from-vault"

    # ── keys ────────────────────────────────────────────────────────────

    def key(self, doc_id: str) -> str:
        return f"{self.root}{sanitize_id(doc_id)}{self.doctype.suffix}"

    def _check_not_reserved(self, doc_id: str) -> None:
        leaf = doc_id.rsplit("/", 1)[-1]
        if leaf in self.doctype.reserved_names:
            raise ValueError(f"'{leaf}' is a reserved name")

    def ids(self, keys: List[str]) -> List[str]:
        """Ids of every document of this kind among `keys` (full backend keys)."""
        suffix = self.doctype.suffix
        return sorted(
            key[len(self.root):-len(suffix)] for key in keys
            if key.startswith(self.root) and key.endswith(suffix) and len(key) > len(self.root) + len(suffix)
            and not key.rsplit("/", 1)[-1].startswith(".")
        )

    # ── reading ─────────────────────────────────────────────────────────

    def read_raw(self, doc_id: str) -> Optional[Dict[str, Any]]:
        text = self.backend.get(self.key(doc_id))
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

    def read_metadata(self, ids: List[str]) -> List[BaseModel]:
        """What a gallery needs of each of `ids`, by name; unreadable ones are left out."""
        with ThreadPoolExecutor(max_workers=8) as pool:
            found = [m for m in pool.map(self._metadata, ids) if m is not None]
        found.sort(key=lambda m: (m.name or "").lower())
        return found

    def list_all(self) -> List[BaseModel]:
        """Every document, at any depth."""
        return self.read_metadata(self.ids(self.backend.list_keys(self.root)))

    # ── writing ─────────────────────────────────────────────────────────

    def write_raw(self, doc_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """Stores `data`, stamped with the time. Returns what was stored."""
        data = {**data, "updated_at": datetime.now(timezone.utc).isoformat()}
        self.backend.put(self.key(doc_id), json.dumps(data, indent=2, ensure_ascii=False))
        return data

    def validated(self, data: Dict[str, Any], previous: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """`data` as it will be stored (see DocType.prepare: `previous` is what
        is stored now, None for a new document)."""
        if self.doctype.prepare:
            data = dict(data)
            self.doctype.prepare(data, previous)
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
        while slug in self.doctype.reserved_names or self.backend.exists(self.key(f"{base}{slug}")):
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
        data = self.validated({"id": doc_id, "name": name, "description": description})
        return self.doctype.model.model_validate(self.write_raw(doc_id, data))

    def restore(self, doc_id: str, data: Dict[str, Any]) -> bool:
        """Stores a document from a backup as it was (its time too), unless
        there is one there already. Returns whether it stored it."""
        doc_id = sanitize_id(doc_id)
        self._check_not_reserved(doc_id)
        if self.backend.exists(self.key(doc_id)):
            return False
        data = {**self.validated({**data, "id": doc_id}), "updated_at": data.get("updated_at")}
        self.backend.put(self.key(doc_id), json.dumps(data, indent=2, ensure_ascii=False))
        return True

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
        data = self.validated(data, existing)
        return self.doctype.model.model_validate(self.write_raw(doc_id, data))

    def set_field(self, doc_id: str, field_name: str, value: Any) -> BaseModel:
        existing = self._require(doc_id)
        data = self.validated({**existing, field_name: value}, existing)
        return self.doctype.model.model_validate(self.write_raw(doc_id, data))

    def rename(self, doc_id: str, name: str) -> BaseModel:
        name = (name or "").strip()
        if not name:
            raise ValueError("A name is required")
        return self.set_field(doc_id, "name", name)

    def delete(self, doc_id: str) -> None:
        self._require(doc_id)
        self.backend.delete(self.key(doc_id))

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
        self.backend.move(self.key(doc_id), self.key(new_id))
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
        if self.backend.exists(self.legacy_marker):
            return 0

        copied = 0
        legacy_filename = f"{self.doctype.kind}.json"
        for file in sorted(root.rglob("*")):
            if not file.is_file():
                continue
            folder = file.parent.relative_to(root).as_posix()
            folder = "" if folder == "." else folder
            try:
                if file.name == legacy_filename:
                    copied += self._import_legacy_file(file, sanitize_id(folder))
                elif file.name == LEGACY_FOLDER_MARKER and folder:
                    key = f"{self.root}{sanitize_folder_path(folder)}/{FOLDER_MARKER}"
                    if not self.backend.exists(key):
                        self.backend.put(key, "")
            except ValueError as e:
                logger.warning(f"Skipped {file} while importing {self.doctype.prefix}: {e}")
        self.backend.put(self.legacy_marker, json.dumps({
            "imported_at": datetime.now(timezone.utc).isoformat(), "documents": copied,
        }))
        if copied:
            logger.info(f"Imported {copied} {self.doctype.prefix} from the vault's {legacy}/")
        return copied

    def _import_legacy_file(self, file: Path, doc_id: str) -> int:
        key = self.key(doc_id)
        if self.backend.exists(key):
            return 0
        text = file.read_text(encoding="utf-8")
        json.loads(text)  # a document that can't be read here couldn't be read later either
        self.backend.put(key, text)
        return 1
