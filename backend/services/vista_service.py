import json
import re
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

from models.vista import Vista, VistaAsset, VistaMetadata, VanishingPoint
from services.document_store import DocumentStore, DocumentStoreError
from services.folder_tree import FolderTree, FolderTreeError, sanitize_folder_path
from config.logging import get_logger

logger = get_logger(__name__)

VISTAS_DIRNAME = "_vistas"


class VistaSaveError(Exception):
    """Raised when writing a vista to disk or to git fails."""
    pass


def _slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-")
    return slug or "vista"


class VistaService:
    def __init__(self, vault_path: str):
        self.vault_path = Path(vault_path)
        self._git_lock = threading.Lock()
        self._tree = FolderTree(self.vault_path, VISTAS_DIRNAME, "vista.json", self._git_lock)
        self._store = DocumentStore(self._tree)
        self.vistas_path = self._tree.root

    def _read(self, vista_id: str) -> Optional[Vista]:
        raw = self._store.read_raw(vista_id)
        if raw is None:
            return None
        vista = Vista.model_validate(raw)
        # The id embedded in the file can go stale after a folder rename/move;
        # the file's actual location relative to vistas_path is authoritative.
        vista.id = vista_id.strip("/")
        return vista

    def list_tree(self, path: str = "") -> dict:
        def read_metadata(vista_file: Path) -> Optional[VistaMetadata]:
            try:
                return VistaMetadata.model_validate(json.loads(vista_file.read_text(encoding="utf-8")))
            except Exception as e:
                logger.error(f"Error reading vista {vista_file}: {e}")
                return None

        raw = self._tree.list_tree(path, read_metadata)
        vistas = []
        for item_id, meta in raw["items"]:
            meta.id = item_id
            vistas.append(meta)
        vistas.sort(key=lambda v: v.name.lower())
        return {"folders": raw["folders"], "vistas": vistas}

    def get_vista(self, vista_id: str) -> Optional[Vista]:
        try:
            return self._read(vista_id)
        except ValueError:
            return None

    def create_vista(
        self, name: str, description: Optional[str], folder_path: str, author_name: str, author_email: str
    ) -> Vista:
        folder_path = sanitize_folder_path(folder_path)
        slug = self._store.unique_slug(_slugify(name), folder_path)

        vista_id = f"{folder_path}/{slug}" if folder_path else slug
        self._tree.check_not_reserved(vista_id)
        vista = Vista(id=vista_id, name=name, description=description)
        self._write(vista, author_name, author_email, verb="Create")
        return vista

    def save_vista(
        self,
        vista_id: str,
        name: str,
        description: Optional[str],
        vanishing_point: VanishingPoint,
        background_offset_y: float,
        assets: List[VistaAsset],
        author_name: str,
        author_email: str,
    ) -> Vista:
        existing = self._read(vista_id)
        if existing is None:
            raise ValueError(f"Vista not found: {vista_id}")

        vista = Vista(
            id=vista_id,
            name=name,
            description=description,
            background_url=existing.background_url,
            vanishing_point=vanishing_point,
            background_offset_y=background_offset_y,
            assets=assets,
        )
        self._write(vista, author_name, author_email, verb="Update")
        return vista

    def set_background_url(self, vista_id: str, background_url: str, author_name: str, author_email: str) -> Vista:
        existing = self._read(vista_id)
        if existing is None:
            raise ValueError(f"Vista not found: {vista_id}")
        existing.background_url = background_url
        self._write(existing, author_name, author_email, verb="Update background for")
        return existing

    def rename_vista(self, vista_id: str, name: str, author_name: str, author_email: str) -> Vista:
        existing = self._read(vista_id)
        if existing is None:
            raise ValueError(f"Vista not found: {vista_id}")
        existing.name = name
        self._write(existing, author_name, author_email, verb="Rename")
        return existing

    def _write(self, vista: Vista, author_name: str, author_email: str, verb: str) -> None:
        vista.updated_at = datetime.now(timezone.utc).isoformat()
        try:
            self._store.write(
                vista.id, vista.model_dump_json(indent=2), author_name, author_email,
                message=f"{verb} vista: {vista.name}",
            )
        except DocumentStoreError as e:
            raise VistaSaveError(str(e))

    def delete_vista(self, vista_id: str, author_name: str, author_email: str) -> None:
        try:
            self._store.delete(
                vista_id, author_name, author_email,
                message=f"Delete vista: {vista_id}",
                not_found_message=f"Vista not found: {vista_id}",
            )
        except DocumentStoreError as e:
            raise VistaSaveError(str(e))

    def move_vista(self, vista_id: str, dest_folder_path: str, author_name: str, author_email: str) -> str:
        """Moves a single vista into `dest_folder_path`, keeping its own
        directory name. Used for drag-and-drop between folders."""
        try:
            return self._tree.move_item(vista_id, dest_folder_path, author_name, author_email, label="vista")
        except FolderTreeError as e:
            raise VistaSaveError(str(e))

    # ── folders ─────────────────────────────────────────────────────────

    def create_folder(self, path: str, author_name: str, author_email: str) -> None:
        try:
            self._tree.create_folder(path, author_name, author_email, label="vista")
        except FolderTreeError as e:
            raise VistaSaveError(str(e))

    def rename_folder(self, path: str, new_name: str, author_name: str, author_email: str) -> None:
        try:
            self._tree.move_folder(path, author_name, author_email, label="vista", new_name=new_name)
        except FolderTreeError as e:
            raise VistaSaveError(str(e))

    def move_folder(self, path: str, dest_parent_path: str, author_name: str, author_email: str) -> None:
        """Moves the folder at `path` to be a child of `dest_parent_path`,
        keeping its own name. Used for drag-and-drop between folders."""
        try:
            self._tree.move_folder(path, author_name, author_email, label="vista", new_parent_path=dest_parent_path)
        except FolderTreeError as e:
            raise VistaSaveError(str(e))

    def delete_folder(self, path: str, author_name: str, author_email: str) -> List[str]:
        try:
            return self._tree.delete_folder(path, author_name, author_email, label="vista")
        except FolderTreeError as e:
            raise VistaSaveError(str(e))
