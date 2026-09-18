import json
import re
import shutil
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

from models.vista import Vista, VistaAsset, VistaMetadata, VanishingPoint
from services.git_sync_utils import GitCommitError, commit_and_push
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
        self.vistas_path = self.vault_path / VISTAS_DIRNAME
        self.vistas_path.mkdir(parents=True, exist_ok=True)
        self._git_lock = threading.Lock()

    def _vista_file(self, vista_id: str) -> Path:
        normalized = vista_id.strip("/")
        if not normalized or any(c in ("", ".", "..") for c in normalized.split("/")) or "\\" in normalized:
            raise ValueError(f"Invalid vista id: {vista_id!r}")

        full_path = (self.vistas_path / normalized / "vista.json").resolve()
        try:
            full_path.relative_to(self.vistas_path.resolve())
        except ValueError:
            raise ValueError("Access denied: path must be within the vistas folder")
        return full_path

    def _read(self, vista_id: str) -> Optional[Vista]:
        vista_file = self._vista_file(vista_id)
        if not vista_file.exists():
            return None
        return Vista.model_validate(json.loads(vista_file.read_text(encoding="utf-8")))

    def list_vistas(self) -> List[VistaMetadata]:
        vistas = []
        for vista_file in self.vistas_path.glob("*/vista.json"):
            try:
                data = json.loads(vista_file.read_text(encoding="utf-8"))
                vistas.append(VistaMetadata.model_validate(data))
            except Exception as e:
                logger.error(f"Error reading vista {vista_file}: {e}")
                continue
        return sorted(vistas, key=lambda v: v.name.lower())

    def get_vista(self, vista_id: str) -> Optional[Vista]:
        try:
            return self._read(vista_id)
        except ValueError:
            return None

    def create_vista(
        self, name: str, description: Optional[str], author_name: str, author_email: str
    ) -> Vista:
        base_slug = _slugify(name)
        slug = base_slug
        suffix = 2
        while (self.vistas_path / slug / "vista.json").exists():
            slug = f"{base_slug}-{suffix}"
            suffix += 1

        vista = Vista(id=slug, name=name, description=description)
        self._write(vista, author_name, author_email, verb="Create")
        return vista

    def save_vista(
        self,
        vista_id: str,
        name: str,
        description: Optional[str],
        vanishing_point: VanishingPoint,
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

    def _write(self, vista: Vista, author_name: str, author_email: str, verb: str) -> None:
        vista.updated_at = datetime.now(timezone.utc).isoformat()
        vista_file = self._vista_file(vista.id)
        vista_file.parent.mkdir(parents=True, exist_ok=True)
        vista_file.write_text(vista.model_dump_json(indent=2), encoding="utf-8")

        rel_path = str(vista_file.relative_to(self.vault_path.resolve()))
        try:
            commit_and_push(
                self.vault_path, self._git_lock, [rel_path],
                message=f"{verb} vista: {vista.name}",
                author_name=author_name, author_email=author_email,
            )
        except GitCommitError as e:
            raise VistaSaveError(str(e))

    def delete_vista(self, vista_id: str, author_name: str, author_email: str) -> None:
        vista_file = self._vista_file(vista_id)
        if not vista_file.exists():
            raise ValueError(f"Vista not found: {vista_id}")

        vista_dir = vista_file.parent
        rel_dir = str(vista_dir.relative_to(self.vault_path.resolve()))
        shutil.rmtree(vista_dir)

        try:
            commit_and_push(
                self.vault_path, self._git_lock, [rel_dir],
                message=f"Delete vista: {vista_id}",
                author_name=author_name, author_email=author_email,
            )
        except GitCommitError as e:
            raise VistaSaveError(str(e))
