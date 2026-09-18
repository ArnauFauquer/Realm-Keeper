import json
import re
import shutil
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

from models.chart import Annotation, Chart, ChartMetadata, ChartPath, Pin
from services.git_sync_utils import GitCommitError, commit_and_push
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
        self.charts_path = self.vault_path / CHARTS_DIRNAME
        self.charts_path.mkdir(parents=True, exist_ok=True)
        self._git_lock = threading.Lock()

    def _chart_file(self, chart_id: str) -> Path:
        normalized = chart_id.strip("/")
        if not normalized or any(c in ("", ".", "..") for c in normalized.split("/")) or "\\" in normalized:
            raise ValueError(f"Invalid chart id: {chart_id!r}")

        full_path = (self.charts_path / normalized / "chart.json").resolve()
        try:
            full_path.relative_to(self.charts_path.resolve())
        except ValueError:
            raise ValueError("Access denied: path must be within the charts folder")
        return full_path

    def _read(self, chart_id: str) -> Optional[Chart]:
        chart_file = self._chart_file(chart_id)
        if not chart_file.exists():
            return None
        return Chart.model_validate(json.loads(chart_file.read_text(encoding="utf-8")))

    def list_charts(self) -> List[ChartMetadata]:
        charts = []
        for chart_file in self.charts_path.glob("*/chart.json"):
            try:
                data = json.loads(chart_file.read_text(encoding="utf-8"))
                charts.append(ChartMetadata.model_validate(data))
            except Exception as e:
                logger.error(f"Error reading chart {chart_file}: {e}")
                continue
        return sorted(charts, key=lambda c: c.name.lower())

    def get_chart(self, chart_id: str) -> Optional[Chart]:
        try:
            return self._read(chart_id)
        except ValueError:
            return None

    def create_chart(
        self, name: str, description: Optional[str], author_name: str, author_email: str
    ) -> Chart:
        base_slug = _slugify(name)
        slug = base_slug
        suffix = 2
        while (self.charts_path / slug / "chart.json").exists():
            slug = f"{base_slug}-{suffix}"
            suffix += 1

        chart = Chart(id=slug, name=name, description=description)
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

    def _write(self, chart: Chart, author_name: str, author_email: str, verb: str) -> None:
        chart.updated_at = datetime.now(timezone.utc).isoformat()
        chart_file = self._chart_file(chart.id)
        chart_file.parent.mkdir(parents=True, exist_ok=True)
        chart_file.write_text(chart.model_dump_json(indent=2), encoding="utf-8")

        rel_path = str(chart_file.relative_to(self.vault_path.resolve()))
        try:
            commit_and_push(
                self.vault_path, self._git_lock, [rel_path],
                message=f"{verb} chart: {chart.name}",
                author_name=author_name, author_email=author_email,
            )
        except GitCommitError as e:
            raise ChartSaveError(str(e))

    def delete_chart(self, chart_id: str, author_name: str, author_email: str) -> None:
        chart_file = self._chart_file(chart_id)
        if not chart_file.exists():
            raise ValueError(f"Chart not found: {chart_id}")

        chart_dir = chart_file.parent
        rel_dir = str(chart_dir.relative_to(self.vault_path.resolve()))
        shutil.rmtree(chart_dir)

        try:
            commit_and_push(
                self.vault_path, self._git_lock, [rel_dir],
                message=f"Delete chart: {chart_id}",
                author_name=author_name, author_email=author_email,
            )
        except GitCommitError as e:
            raise ChartSaveError(str(e))
