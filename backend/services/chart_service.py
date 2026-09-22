import json
import re
import threading
from pathlib import Path
from datetime import datetime, timezone
from typing import List, Optional

from models.chart import Annotation, Chart, ChartMetadata, ChartPath, Pin
from services.document_store import DocumentStore, DocumentStoreError
from services.folder_tree import FolderTree, FolderTreeError, sanitize_folder_path
from config.logging import get_logger

logger = get_logger(__name__)

CHARTS_DIRNAME = "_charts"


class ChartSaveError(Exception):
    """Raised when writing a chart to disk or to git fails."""
    pass


def _slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-")
    return slug or "chart"


class ChartService:
    def __init__(self, vault_path: str):
        self.vault_path = Path(vault_path)
        self._git_lock = threading.Lock()
        self._tree = FolderTree(self.vault_path, CHARTS_DIRNAME, "chart.json", self._git_lock)
        self._store = DocumentStore(self._tree)
        self.charts_path = self._tree.root

    def _read(self, chart_id: str) -> Optional[Chart]:
        raw = self._store.read_raw(chart_id)
        if raw is None:
            return None
        chart = Chart.model_validate(raw)
        # The id embedded in the file can go stale after a folder rename/move;
        # the file's actual location relative to charts_path is authoritative.
        chart.id = chart_id.strip("/")
        return chart

    def list_tree(self, path: str = "") -> dict:
        def read_metadata(chart_file: Path) -> Optional[ChartMetadata]:
            try:
                return ChartMetadata.model_validate(json.loads(chart_file.read_text(encoding="utf-8")))
            except Exception as e:
                logger.error(f"Error reading chart {chart_file}: {e}")
                return None

        raw = self._tree.list_tree(path, read_metadata)
        charts = []
        for item_id, meta in raw["items"]:
            meta.id = item_id
            charts.append(meta)
        charts.sort(key=lambda c: c.name.lower())
        return {"folders": raw["folders"], "charts": charts}

    def get_chart(self, chart_id: str) -> Optional[Chart]:
        try:
            return self._read(chart_id)
        except ValueError:
            return None

    def create_chart(
        self, name: str, description: Optional[str], folder_path: str, author_name: str, author_email: str
    ) -> Chart:
        folder_path = sanitize_folder_path(folder_path)
        slug = self._store.unique_slug(_slugify(name), folder_path)

        chart_id = f"{folder_path}/{slug}" if folder_path else slug
        self._tree.check_not_reserved(chart_id)
        chart = Chart(id=chart_id, name=name, description=description)
        self._write(chart, author_name, author_email, verb="Create")
        return chart

    def save_chart(
        self,
        chart_id: str,
        name: str,
        description: Optional[str],
        pins: List[Pin],
        paths: List[ChartPath],
        annotations: List[Annotation],
        author_name: str,
        author_email: str,
    ) -> Chart:
        existing = self._read(chart_id)
        if existing is None:
            raise ValueError(f"Chart not found: {chart_id}")

        chart = Chart(
            id=chart_id,
            name=name,
            description=description,
            image_url=existing.image_url,
            pins=pins,
            paths=paths,
            annotations=annotations,
        )
        self._write(chart, author_name, author_email, verb="Update")
        return chart

    def set_image_url(self, chart_id: str, image_url: str, author_name: str, author_email: str) -> Chart:
        existing = self._read(chart_id)
        if existing is None:
            raise ValueError(f"Chart not found: {chart_id}")
        existing.image_url = image_url
        self._write(existing, author_name, author_email, verb="Update image for")
        return existing

    def rename_chart(self, chart_id: str, name: str, author_name: str, author_email: str) -> Chart:
        existing = self._read(chart_id)
        if existing is None:
            raise ValueError(f"Chart not found: {chart_id}")
        existing.name = name
        self._write(existing, author_name, author_email, verb="Rename")
        return existing

    def _write(self, chart: Chart, author_name: str, author_email: str, verb: str) -> None:
        chart.updated_at = datetime.now(timezone.utc).isoformat()
        try:
            self._store.write(
                chart.id, chart.model_dump_json(indent=2), author_name, author_email,
                message=f"{verb} chart: {chart.name}",
            )
        except DocumentStoreError as e:
            raise ChartSaveError(str(e))

    def delete_chart(self, chart_id: str, author_name: str, author_email: str) -> None:
        try:
            self._store.delete(
                chart_id, author_name, author_email,
                message=f"Delete chart: {chart_id}",
                not_found_message=f"Chart not found: {chart_id}",
            )
        except DocumentStoreError as e:
            raise ChartSaveError(str(e))

    def move_chart(self, chart_id: str, dest_folder_path: str, author_name: str, author_email: str) -> str:
        """Moves a single chart into `dest_folder_path`, keeping its own
        directory name. Used for drag-and-drop between folders."""
        try:
            return self._tree.move_item(chart_id, dest_folder_path, author_name, author_email, label="chart")
        except FolderTreeError as e:
            raise ChartSaveError(str(e))

    # ── folders ─────────────────────────────────────────────────────────

    def create_folder(self, path: str, author_name: str, author_email: str) -> None:
        try:
            self._tree.create_folder(path, author_name, author_email, label="chart")
        except FolderTreeError as e:
            raise ChartSaveError(str(e))

    def rename_folder(self, path: str, new_name: str, author_name: str, author_email: str) -> None:
        try:
            self._tree.move_folder(path, author_name, author_email, label="chart", new_name=new_name)
        except FolderTreeError as e:
            raise ChartSaveError(str(e))

    def move_folder(self, path: str, dest_parent_path: str, author_name: str, author_email: str) -> None:
        """Moves the folder at `path` to be a child of `dest_parent_path`,
        keeping its own name. Used for drag-and-drop between folders."""
        try:
            self._tree.move_folder(path, author_name, author_email, label="chart", new_parent_path=dest_parent_path)
        except FolderTreeError as e:
            raise ChartSaveError(str(e))

    def delete_folder(self, path: str, author_name: str, author_email: str) -> List[str]:
        try:
            return self._tree.delete_folder(path, author_name, author_email, label="chart")
        except FolderTreeError as e:
            raise ChartSaveError(str(e))
