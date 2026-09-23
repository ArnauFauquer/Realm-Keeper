"""Generic git-backed folder tree: each "item" is a directory holding a
fixed-name JSON file (vista.json, chart.json, ...). VistaService and
ChartService both used to hand-roll their own copy of this (create/rename/
move/delete folder, walk the tree) — this is that logic, written once and
shared, so only what an item actually IS stays in each service."""
import shutil
import threading
from pathlib import Path
from typing import Callable, List, Optional

from services.git_sync_utils import GitCommitError, commit_and_push

FOLDER_MARKER = ".gitkeep"


class FolderTreeError(Exception):
    """Raised when a folder-tree operation fails to save to git."""
    pass


def sanitize_folder_path(path: str) -> str:
    """Validate a (possibly multi-level) folder path: every segment must be
    a safe path component. Returns "" for the root."""
    segments = [s for s in (path or "").strip("/").split("/") if s]
    for s in segments:
        # Dot-prefixed covers ".", ".." and hidden names like ".git".
        if s.startswith(".") or "\\" in s:
            raise ValueError(f"Invalid folder path: {path!r}")
    return "/".join(segments)


def sanitize_folder_name(name: str) -> str:
    name = (name or "").strip()
    if not name or name.startswith(".") or "/" in name or "\\" in name:
        raise ValueError(f"Invalid folder name: {name!r}")
    return name


class FolderTree:
    def __init__(
        self, vault_path: Path, dirname: str, item_filename: str,
        git_lock: threading.Lock, reserved_top_segments: Optional[set] = None,
    ):
        self.vault_path = vault_path
        self.root = vault_path / dirname
        self.root.mkdir(parents=True, exist_ok=True)
        self.item_filename = item_filename
        self.git_lock = git_lock
        # "assets" and "folders" are fixed top-level routes on every one of
        # these resources — an item or folder living at the root under one
        # of these names would be unreachable.
        self.reserved_top_segments = reserved_top_segments or {"assets", "folders"}

    def check_not_reserved(self, path: str) -> None:
        top = path.split("/", 1)[0]
        if top in self.reserved_top_segments:
            raise ValueError(f"'{top}' is a reserved name at the top level")

    def item_dir(self, item_id: str) -> Path:
        normalized = (item_id or "").strip("/")
        if not normalized or any(not c or c.startswith(".") for c in normalized.split("/")) or "\\" in normalized:
            raise ValueError(f"Invalid id: {item_id!r}")
        full_path = (self.root / normalized).resolve()
        try:
            full_path.relative_to(self.root.resolve())
        except ValueError:
            raise ValueError("Access denied: path must be within the folder")
        return full_path

    def list_tree(self, path: str, read_metadata: Callable[[Path], Optional[object]]) -> dict:
        """Immediate subfolders and items directly under `path` (not
        recursive). `read_metadata(item_file)` parses one item's JSON into
        whatever metadata model the caller uses; returns (id, metadata)
        pairs so the caller doesn't need to re-derive ids itself."""
        path = sanitize_folder_path(path)
        base = (self.root / path) if path else self.root

        folders = []
        items = []
        if base.is_dir():
            for entry in base.iterdir():
                if not entry.is_dir():
                    continue
                item_file = entry / self.item_filename
                if item_file.exists():
                    meta = read_metadata(item_file)
                    if meta is not None:
                        item_id = f"{path}/{entry.name}" if path else entry.name
                        items.append((item_id, meta))
                else:
                    folders.append(entry.name)

        folders.sort(key=str.lower)
        return {"folders": folders, "items": items}

    def _commit(self, rel_paths: List[str], message: str, author_name: str, author_email: str) -> None:
        try:
            commit_and_push(
                self.vault_path, self.git_lock, rel_paths,
                message=message, author_name=author_name, author_email=author_email,
            )
        except GitCommitError as e:
            raise FolderTreeError(str(e))

    def create_folder(self, path: str, author_name: str, author_email: str, label: str) -> None:
        path = sanitize_folder_path(path)
        if not path:
            raise ValueError("Folder path is required")
        self.check_not_reserved(path)

        folder_dir = self.root / path
        if folder_dir.exists():
            raise ValueError(f"A folder or {label} already exists at '{path}'")
        folder_dir.mkdir(parents=True, exist_ok=True)
        marker = folder_dir / FOLDER_MARKER
        marker.write_text("", encoding="utf-8")

        rel_path = str(marker.resolve().relative_to(self.vault_path.resolve()))
        self._commit([rel_path], f"Create {label} folder: {path}", author_name, author_email)

    def move_folder(
        self, path: str, author_name: str, author_email: str, label: str,
        new_parent_path: Optional[str] = None, new_name: Optional[str] = None,
    ) -> None:
        """Renames and/or reparents the folder at `path`. Passing only
        `new_name` renames it in place (same parent); passing only
        `new_parent_path` moves it under a new parent, keeping its name."""
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
        self.check_not_reserved(new_path)

        old_dir = self.root / path
        new_dir = self.root / new_path
        if not old_dir.is_dir():
            raise ValueError(f"Folder not found: {path}")
        if new_dir.exists():
            raise ValueError(f"A folder or {label} already exists at '{new_path}'")

        old_dir_resolved = old_dir.resolve()
        old_dir.rename(new_dir)
        old_rel = str(old_dir_resolved.relative_to(self.vault_path.resolve()))
        new_rel = str(new_dir.resolve().relative_to(self.vault_path.resolve()))

        verb = "Rename" if new_parent_path is None else "Move"
        self._commit([old_rel, new_rel], f"{verb} {label} folder: {path} -> {new_path}", author_name, author_email)

    def delete_folder(self, path: str, author_name: str, author_email: str, label: str) -> List[str]:
        """Deletes a folder and everything nested inside it (cascading, like
        rm -rf). Returns the ids of every item that was inside, so the
        caller can also clean up whatever else keys off that id (S3 assets,
        etc)."""
        path = sanitize_folder_path(path)
        if not path:
            raise ValueError("Folder path is required")

        folder_dir = self.root / path
        if not folder_dir.is_dir():
            raise ValueError(f"Folder not found: {path}")

        doomed_ids = [
            item_file.parent.relative_to(self.root).as_posix()
            for item_file in folder_dir.glob(f"**/{self.item_filename}")
        ]

        rel_dir = str(folder_dir.resolve().relative_to(self.vault_path.resolve()))
        shutil.rmtree(folder_dir)
        self._commit([rel_dir], f"Delete {label} folder: {path} (and its contents)", author_name, author_email)
        return doomed_ids

    def move_item(self, item_id: str, dest_folder_path: str, author_name: str, author_email: str, label: str) -> str:
        """Moves a single item's whole directory into `dest_folder_path`,
        keeping its own directory name. Returns the item's new id."""
        old_dir = self.item_dir(item_id)
        if not (old_dir / self.item_filename).exists():
            raise ValueError(f"Not found: {item_id}")

        dest_folder_path = sanitize_folder_path(dest_folder_path)
        leaf = old_dir.name
        new_id = f"{dest_folder_path}/{leaf}" if dest_folder_path else leaf
        self.check_not_reserved(new_id)

        new_dir = self.root / new_id
        if old_dir == new_dir:
            return item_id.strip("/")
        if new_dir.exists():
            raise ValueError(f"A {label} already exists at '{new_id}'")

        old_dir.rename(new_dir)
        old_rel = str(old_dir.relative_to(self.vault_path.resolve()))
        new_rel = str(new_dir.resolve().relative_to(self.vault_path.resolve()))
        self._commit([old_rel, new_rel], f"Move {label}: {item_id} -> {new_id}", author_name, author_email)
        return new_id
