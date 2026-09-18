import json
import re
import shutil
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

from models.asset_library import LibraryAsset, LibraryFolder
from services.git_sync_utils import GitCommitError, commit_and_push
from config.logging import get_logger

logger = get_logger(__name__)

LIBRARY_DIRNAME = "_asset_library"
# Sibling of the per-item directories, not a possible item id (slugify never
# produces a leading underscore), so folder and asset ids never collide.
FOLDERS_DIRNAME = "_folders"


class LibraryAssetSaveError(Exception):
    """Raised when writing a library asset or folder to disk or to git fails."""
    pass


def _slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-")
    return slug or "asset"


class AssetLibraryService:
    def __init__(self, vault_path: str):
        self.vault_path = Path(vault_path)
        self.library_path = self.vault_path / LIBRARY_DIRNAME
        self.library_path.mkdir(parents=True, exist_ok=True)
        self.folders_path = self.library_path / FOLDERS_DIRNAME
        self.folders_path.mkdir(parents=True, exist_ok=True)
        self._git_lock = threading.Lock()

    # ── assets ──────────────────────────────────────────────────────────

    def _item_file(self, item_id: str) -> Path:
        normalized = item_id.strip("/")
        if not normalized or any(c in ("", ".", "..") for c in normalized.split("/")) or "\\" in normalized:
            raise ValueError(f"Invalid asset id: {item_id!r}")

        full_path = (self.library_path / normalized / "item.json").resolve()
        try:
            full_path.relative_to(self.library_path.resolve())
        except ValueError:
            raise ValueError("Access denied: path must be within the asset library folder")
        return full_path

    def _read(self, item_id: str) -> Optional[LibraryAsset]:
        item_file = self._item_file(item_id)
        if not item_file.exists():
            return None
        return LibraryAsset.model_validate(json.loads(item_file.read_text(encoding="utf-8")))

    def list_assets(self) -> List[LibraryAsset]:
        items = []
        for item_file in self.library_path.glob("*/item.json"):
            try:
                data = json.loads(item_file.read_text(encoding="utf-8"))
                items.append(LibraryAsset.model_validate(data))
            except Exception as e:
                logger.error(f"Error reading library asset {item_file}: {e}")
                continue
        return sorted(items, key=lambda a: a.name.lower())

    def get_asset(self, item_id: str) -> Optional[LibraryAsset]:
        try:
            return self._read(item_id)
        except ValueError:
            return None

    def create_asset(self, name: str, folder_id: Optional[str], author_name: str, author_email: str) -> LibraryAsset:
        base_slug = _slugify(name)
        slug = base_slug
        suffix = 2
        while (self.library_path / slug / "item.json").exists():
            slug = f"{base_slug}-{suffix}"
            suffix += 1

        item = LibraryAsset(id=slug, name=name, folder_id=folder_id)
        self._write(item, author_name, author_email, verb="Add")
        return item

    def update_asset(
        self, item_id: str, name: str, folder_id: Optional[str], author_name: str, author_email: str
    ) -> LibraryAsset:
        existing = self._read(item_id)
        if existing is None:
            raise ValueError(f"Asset not found: {item_id}")
        existing.name = name
        existing.folder_id = folder_id
        self._write(existing, author_name, author_email, verb="Update")
        return existing

    def set_image_url(self, item_id: str, image_url: str, author_name: str, author_email: str) -> LibraryAsset:
        existing = self._read(item_id)
        if existing is None:
            raise ValueError(f"Asset not found: {item_id}")
        existing.image_url = image_url
        self._write(existing, author_name, author_email, verb="Update image for")
        return existing

    def _write(self, item: LibraryAsset, author_name: str, author_email: str, verb: str) -> None:
        item.updated_at = datetime.now(timezone.utc).isoformat()
        item_file = self._item_file(item.id)
        item_file.parent.mkdir(parents=True, exist_ok=True)
        item_file.write_text(item.model_dump_json(indent=2), encoding="utf-8")

        rel_path = str(item_file.relative_to(self.vault_path.resolve()))
        try:
            commit_and_push(
                self.vault_path, self._git_lock, [rel_path],
                message=f"{verb} library asset: {item.name}",
                author_name=author_name, author_email=author_email,
            )
        except GitCommitError as e:
            raise LibraryAssetSaveError(str(e))

    def delete_asset(self, item_id: str, author_name: str, author_email: str) -> None:
        item_file = self._item_file(item_id)
        if not item_file.exists():
            raise ValueError(f"Asset not found: {item_id}")

        item_dir = item_file.parent
        rel_dir = str(item_dir.relative_to(self.vault_path.resolve()))
        shutil.rmtree(item_dir)

        try:
            commit_and_push(
                self.vault_path, self._git_lock, [rel_dir],
                message=f"Delete library asset: {item_id}",
                author_name=author_name, author_email=author_email,
            )
        except GitCommitError as e:
            raise LibraryAssetSaveError(str(e))

    # ── folders ─────────────────────────────────────────────────────────

    def _folder_file(self, folder_id: str) -> Path:
        normalized = folder_id.strip("/")
        if not normalized or any(c in ("", ".", "..") for c in normalized.split("/")) or "\\" in normalized:
            raise ValueError(f"Invalid folder id: {folder_id!r}")

        full_path = (self.folders_path / normalized / "folder.json").resolve()
        try:
            full_path.relative_to(self.folders_path.resolve())
        except ValueError:
            raise ValueError("Access denied: path must be within the folders directory")
        return full_path

    def _read_folder(self, folder_id: str) -> Optional[LibraryFolder]:
        folder_file = self._folder_file(folder_id)
        if not folder_file.exists():
            return None
        return LibraryFolder.model_validate(json.loads(folder_file.read_text(encoding="utf-8")))

    def list_folders(self) -> List[LibraryFolder]:
        folders = []
        for folder_file in self.folders_path.glob("*/folder.json"):
            try:
                data = json.loads(folder_file.read_text(encoding="utf-8"))
                folders.append(LibraryFolder.model_validate(data))
            except Exception as e:
                logger.error(f"Error reading library folder {folder_file}: {e}")
                continue
        return sorted(folders, key=lambda f: f.name.lower())

    def create_folder(
        self, name: str, parent_id: Optional[str], author_name: str, author_email: str
    ) -> LibraryFolder:
        if parent_id is not None and self._read_folder(parent_id) is None:
            raise ValueError(f"Parent folder not found: {parent_id}")

        base_slug = _slugify(name)
        slug = base_slug
        suffix = 2
        while (self.folders_path / slug / "folder.json").exists():
            slug = f"{base_slug}-{suffix}"
            suffix += 1

        folder = LibraryFolder(id=slug, name=name, parent_id=parent_id)
        self._write_folder(folder, author_name, author_email, verb="Add")
        return folder

    def rename_folder(self, folder_id: str, name: str, author_name: str, author_email: str) -> LibraryFolder:
        existing = self._read_folder(folder_id)
        if existing is None:
            raise ValueError(f"Folder not found: {folder_id}")
        existing.name = name
        self._write_folder(existing, author_name, author_email, verb="Rename")
        return existing

    def _write_folder(self, folder: LibraryFolder, author_name: str, author_email: str, verb: str) -> None:
        folder.updated_at = datetime.now(timezone.utc).isoformat()
        folder_file = self._folder_file(folder.id)
        folder_file.parent.mkdir(parents=True, exist_ok=True)
        folder_file.write_text(folder.model_dump_json(indent=2), encoding="utf-8")

        rel_path = str(folder_file.relative_to(self.vault_path.resolve()))
        try:
            commit_and_push(
                self.vault_path, self._git_lock, [rel_path],
                message=f"{verb} asset folder: {folder.name}",
                author_name=author_name, author_email=author_email,
            )
        except GitCommitError as e:
            raise LibraryAssetSaveError(str(e))

    def delete_folder(self, folder_id: str, author_name: str, author_email: str) -> List[LibraryAsset]:
        """Deletes a folder, every folder nested inside it, and every asset
        those contain (cascading, like deleting a directory). Returns the
        deleted assets so the caller can also clean up their S3 objects."""
        folder = self._read_folder(folder_id)
        if folder is None:
            raise ValueError(f"Folder not found: {folder_id}")

        all_folders = self.list_folders()
        all_assets = self.list_assets()

        doomed_folder_ids = {folder_id}
        grew = True
        while grew:
            grew = False
            for f in all_folders:
                if f.parent_id in doomed_folder_ids and f.id not in doomed_folder_ids:
                    doomed_folder_ids.add(f.id)
                    grew = True

        doomed_assets = [a for a in all_assets if a.folder_id in doomed_folder_ids]

        rel_paths = []
        for asset in doomed_assets:
            item_dir = self._item_file(asset.id).parent
            if item_dir.exists():
                shutil.rmtree(item_dir)
            rel_paths.append(str(item_dir.relative_to(self.vault_path.resolve())))

        for fid in doomed_folder_ids:
            folder_dir = self._folder_file(fid).parent
            if folder_dir.exists():
                shutil.rmtree(folder_dir)
            rel_paths.append(str(folder_dir.relative_to(self.vault_path.resolve())))

        try:
            commit_and_push(
                self.vault_path, self._git_lock, rel_paths,
                message=f"Delete asset folder: {folder.name} (and its contents)",
                author_name=author_name, author_email=author_email,
            )
        except GitCommitError as e:
            raise LibraryAssetSaveError(str(e))

        return doomed_assets
