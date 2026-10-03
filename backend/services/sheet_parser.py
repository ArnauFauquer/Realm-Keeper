"""Turns the YAML of a ```sheet block into a normalized SheetSpec.

frontend/src/utils/sheet.js does the same normalization for rendering; both
are checked against the shared cases in tests/fixtures/sheets/, so a change
here needs the same change there.
"""
import re
import unicodedata
from typing import Any, List, Optional, Tuple

import yaml
from pydantic import ValidationError

from models.sheet import ResourceSpec, SheetItem, SheetSection, SheetSpec, StatSpec
from services.storage_service import ASSET_LIBRARY_PREFIX, ASSET_LIBRARY_URL_PREFIX

SHEET_TYPES = ("character", "adversary")
KNOWN_FIELDS = {"id", "name", "type", "subtitle", "image", "tags", "resources", "stats", "sections", "text"}


class SheetParseError(ValueError):
    """The block isn't a valid sheet; the message is meant for its author."""


def slugify(text: str) -> str:
    """Lowercase ASCII with hyphens: "Jabalí Gigante" -> "jabali-gigante"."""
    ascii_text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", "-", ascii_text.lower()).strip("-")


def _text(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _tags(value: Any) -> List[str]:
    if value is None:
        return []
    items = value.split(",") if isinstance(value, str) else value if isinstance(value, list) else [value]
    return [tag for tag in (_text(item) for item in items) if tag]


def normalize_image(value: Any) -> Tuple[Optional[str], Optional[str]]:
    """(url, warning). Library images are stored as the app's relative URL, so
    one pasted with the site's address in front (or as a bare library key)
    still matches what a chart pin or a map token may use."""
    image = _text(value)
    if not image:
        return None, None
    marker = image.find(ASSET_LIBRARY_URL_PREFIX)
    if marker != -1:
        return image[marker:], None
    if image.startswith(ASSET_LIBRARY_PREFIX):
        return ASSET_LIBRARY_URL_PREFIX + image, None
    if re.match(r"^https?://", image, re.IGNORECASE):
        return image, None
    return None, "image must be the URL of an asset library image, as copied from the library"


def _integer(value: Any, what: str) -> int:
    is_whole = isinstance(value, int) or (isinstance(value, float) and value.is_integer())
    if isinstance(value, bool) or not is_whole:
        raise SheetParseError(f"{what} must be a whole number")
    return int(value)


def _resource(name: str, raw: Any) -> ResourceSpec:
    if isinstance(raw, dict):
        if "max" not in raw:
            raise SheetParseError(f"resource '{name}' needs a max")
        spec = {
            "max": _integer(raw["max"], f"resource '{name}' max"),
            "min": _integer(raw.get("min", 0), f"resource '{name}' min"),
            "color": _text(raw.get("color")),
            "style": _text(raw.get("style")),
        }
        if raw.get("start") is not None:
            spec["start"] = _integer(raw["start"], f"resource '{name}' start")
    else:
        spec = {"max": _integer(raw, f"resource '{name}'")}
    resource = ResourceSpec(**spec)
    if resource.min > resource.max:
        raise SheetParseError(f"resource '{name}' has a min above its max")
    return resource


def _resources(raw: Any) -> dict:
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise SheetParseError("resources must be a mapping of name to maximum, e.g. HP: 6")
    return {str(name): _resource(str(name), value) for name, value in raw.items()}


def _stats(raw: Any) -> List[StatSpec]:
    if raw is None:
        return []
    if not isinstance(raw, dict):
        raise SheetParseError("stats must be a mapping of label to value")
    stats = []
    for label, value in raw.items():
        if isinstance(value, dict):
            stats.append(StatSpec(label=str(label), value=value.get("value"), roll=_text(value.get("roll"))))
        else:
            stats.append(StatSpec(label=str(label), value=value))
    return stats


def _item(raw: Any) -> SheetItem:
    if isinstance(raw, dict):
        return SheetItem(
            name=_text(raw.get("name")), text=_text(raw.get("text")), roll=_text(raw.get("roll")),
            tags=_tags(raw.get("tags")), cost=_text(raw.get("cost")),
        )
    return SheetItem(text=_text(raw))


def _sections(raw: Any) -> List[SheetSection]:
    if raw is None:
        return []
    if not isinstance(raw, list) or not all(isinstance(section, dict) for section in raw):
        raise SheetParseError("sections must be a list, each with a title and its items")
    sections = []
    for section in raw:
        items = section.get("items")
        if items is not None and not isinstance(items, list):
            raise SheetParseError("a section's items must be a list")
        sections.append(SheetSection(title=_text(section.get("title")), items=[_item(i) for i in items or []]))
    return sections


def parse_sheet_source(source: str) -> Tuple[SheetSpec, List[str]]:
    """The sheet a block describes, plus warnings about things that parsed
    but are probably not what the author meant. Raises SheetParseError."""
    try:
        data = yaml.safe_load(source)
    except yaml.YAMLError as e:
        problem = getattr(e, "problem", None) or str(e)
        raise SheetParseError(f"Invalid YAML: {problem}")
    if not isinstance(data, dict):
        raise SheetParseError("A sheet must be a YAML mapping (name: ..., resources: ...)")

    name = _text(data.get("name"))
    if not name:
        raise SheetParseError("A sheet needs a name")
    sheet_type = (_text(data.get("type")) or "adversary").lower()
    if sheet_type not in SHEET_TYPES:
        raise SheetParseError(f"type must be one of: {', '.join(SHEET_TYPES)}")

    warnings = [f"Unknown field '{key}'" for key in data if str(key) not in KNOWN_FIELDS]
    explicit_id = slugify(_text(data.get("id")) or "")
    sheet_id = explicit_id or slugify(name)
    if not sheet_id:
        raise SheetParseError("The sheet's id needs at least one letter or number")
    if sheet_type == "character" and not explicit_id:
        warnings.append("A character should declare a stable id: its saved values are kept under it")
    image, image_warning = normalize_image(data.get("image"))
    if image_warning:
        warnings.append(image_warning)

    try:
        spec = SheetSpec(
            id=sheet_id, name=name, type=sheet_type, subtitle=_text(data.get("subtitle")), image=image,
            tags=_tags(data.get("tags")), resources=_resources(data.get("resources")),
            stats=_stats(data.get("stats")), sections=_sections(data.get("sections")),
            text=_text(data.get("text")),
        )
    except ValidationError as e:
        raise SheetParseError(f"Invalid sheet: {e.errors()[0]['msg']}")
    return spec, warnings
