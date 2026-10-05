"""Turns the YAML of a sheet (a character's or an adversary's `source`) into a
normalized SheetSpec.

frontend/src/utils/sheet.js does the same normalization for rendering; both
are checked against the shared cases in tests/fixtures/sheets/, so a change
here needs the same change there.
"""
import re
import unicodedata
from typing import Any, Dict, List, Optional, Tuple

import yaml
from pydantic import ValidationError

from models.encounter import MAX_COUNTER_COLOR_LENGTH, MAX_COUNTER_STYLE_LENGTH, MAX_COUNTERS
from models.sheet import ResourceSpec, SheetItem, SheetSection, SheetSpec, StatGroup, StatSpec
from services.observatory import image_uid, image_url, is_image_name
from services.storage_service import IMAGE_URL_PREFIX

SHEET_TYPES = ("character", "adversary")
# A sheet is a few dozen lines. The limit keeps a block pasted by mistake (or a
# hostile one) from being parsed, and from taking the whole catalog with it.
MAX_SOURCE_LENGTH = 100_000
KNOWN_FIELDS = {"id", "name", "type", "subtitle", "image", "tags", "stats", "sections", "columns", "text"}
# How many columns a layout may ask for (the sheet's sections, a section's
# items, a group of stats). Narrow screens fall back to fewer on their own.
MAX_COLUMNS = 12


class SheetParseError(ValueError):
    """The block isn't a valid sheet; the message is meant for its author."""


class _NoAliasLoader(yaml.SafeLoader):
    """SafeLoader without aliases (`*name`). An alias is a reference, so a few
    hundred bytes of nested ones parse to almost nothing and then expand to
    gigabytes when the sheet is turned into JSON: a "billion laughs" that a
    public note could use against the server. Sheets have no use for them. (The
    frontend refuses them too, in utils/pythonYaml.js.)"""

    def compose_node(self, parent, index):
        if self.check_event(yaml.AliasEvent):
            event = self.peek_event()
            raise yaml.YAMLError(f"aliases (*{event.anchor}) aren't supported in a sheet")
        return super().compose_node(parent, index)


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
    """(url, warning). Observatory images are stored as the app's relative URL,
    so one pasted with the site's address in front (or as the image's bare file
    name, "1a2b3c4d-boar.png") still matches what a chart pin or a map token may use."""
    image = _text(value)
    if not image:
        return None, None
    marker = image.find(IMAGE_URL_PREFIX)
    if marker != -1:
        return image[marker:], None
    if image_uid(image) and is_image_name(image) and "/" not in image:
        return image_url(image), None
    if re.match(r"^https?://", image, re.IGNORECASE):
        return image, None
    return None, "image must be the URL of an Observatory image, as copied from the Observatory"


def _integer(value: Any, what: str) -> int:
    is_whole = isinstance(value, int) or (isinstance(value, float) and value.is_integer())
    if isinstance(value, bool) or not is_whole:
        raise SheetParseError(f"{what} must be a whole number")
    return int(value)


def _counter(name: str, raw: Any) -> ResourceSpec:
    if isinstance(raw, dict):
        if "max" not in raw:
            raise SheetParseError(f"counter '{name}' needs a max")
        spec = {
            "max": _integer(raw["max"], f"counter '{name}' max"),
            "min": _integer(raw.get("min", 0), f"counter '{name}' min"),
            "color": _text(raw.get("color")),
            "style": _text(raw.get("style")),
        }
        if raw.get("start") is not None:
            spec["start"] = _integer(raw["start"], f"counter '{name}' start")
    else:
        spec = {"max": _integer(raw, f"counter '{name}'")}
    counter = ResourceSpec(**spec)
    if counter.min > counter.max:
        raise SheetParseError(f"counter '{name}' has a min above its max")
    # The limits of a counter in an encounter (models/encounter.py ResourceState).
    if counter.color and len(counter.color) > MAX_COUNTER_COLOR_LENGTH:
        raise SheetParseError(f"counter '{name}' color can't be longer than {MAX_COUNTER_COLOR_LENGTH} characters")
    if counter.style and len(counter.style) > MAX_COUNTER_STYLE_LENGTH:
        raise SheetParseError(f"counter '{name}' style can't be longer than {MAX_COUNTER_STYLE_LENGTH} characters")
    return counter


def _counters(raw: Any) -> dict:
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise SheetParseError("a section's counters must be a mapping of name to maximum, e.g. HP: 6")
    return {str(name): _counter(str(name), value) for name, value in raw.items()}


def _columns(value: Any, what: str) -> Optional[int]:
    if value is None:
        return None
    n = _integer(value, what)
    if not 1 <= n <= MAX_COLUMNS:
        raise SheetParseError(f"{what} must be between 1 and {MAX_COLUMNS}")
    return n


def _stat_list(raw: dict) -> List[StatSpec]:
    stats = []
    for label, value in raw.items():
        if isinstance(value, dict):
            stats.append(StatSpec(label=str(label), value=value.get("value"), roll=_text(value.get("roll"))))
        else:
            stats.append(StatSpec(label=str(label), value=value))
    return stats


def _stat_group(raw: Any) -> StatGroup:
    """A plain mapping of stats, or {title, columns, stats} (told apart by
    having a `stats` key)."""
    if not isinstance(raw, dict):
        raise SheetParseError("each group of stats must be a mapping of label to value")
    if "stats" in raw:
        if not isinstance(raw["stats"], dict):
            raise SheetParseError("a stat group's stats must be a mapping of label to value")
        return StatGroup(
            title=_text(raw.get("title")), columns=_columns(raw.get("columns"), "a stat group's columns"),
            stats=_stat_list(raw["stats"]),
        )
    return StatGroup(stats=_stat_list(raw))


def _stats(raw: Any) -> List[StatGroup]:
    """Always a list of groups: a single mapping is one untitled group."""
    if raw is None:
        return []
    if isinstance(raw, list):
        return [_stat_group(group) for group in raw]
    if not isinstance(raw, dict):
        raise SheetParseError("stats must be a mapping of label to value, or a list of groups of them")
    return [_stat_group(raw)] if raw else []


def _item(raw: Any) -> SheetItem:
    if isinstance(raw, dict):
        return SheetItem(
            name=_text(raw.get("name")), text=_text(raw.get("text")), roll=_text(raw.get("roll")),
            tags=_tags(raw.get("tags")), cost=_text(raw.get("cost")),
        )
    return SheetItem(text=_text(raw))


def _sections(raw: Any) -> Tuple[List[SheetSection], dict]:
    """(sections, resources): each section names its counters, and every
    counter of the sheet is also in `resources` (by name, in order), which is
    what encounters and saved characters go by."""
    if raw is None:
        return [], {}
    if not isinstance(raw, list) or not all(isinstance(section, dict) for section in raw):
        raise SheetParseError("sections must be a list, each with a title and its items")
    sections, resources = [], {}
    for section in raw:
        items = section.get("items")
        if items is not None and not isinstance(items, list):
            raise SheetParseError("a section's items must be a list")
        own = _counters(section.get("counters"))
        for name, spec in own.items():
            if name in resources:
                raise SheetParseError(f"counter '{name}' is defined twice: counter names must be unique in a sheet")
            resources[name] = spec
        sections.append(SheetSection(
            title=_text(section.get("title")), columns=_columns(section.get("columns"), "a section's columns"),
            wide=section.get("wide") is True, collapsed=section.get("collapsed") is True,
            tab=_text(section.get("tab")), counters=list(own), stats=_stats(section.get("stats")), items=[_item(i) for i in items or []],
        ))
    if len(resources) > MAX_COUNTERS:
        raise SheetParseError(f"a sheet can't have more than {MAX_COUNTERS} counters")
    return sections, resources


# What a sheet document holds outside its YAML: its name is the document's
# (renamed from the gallery), its id is where it is stored, and its type is its
# kind. The YAML may still carry them (a sheet pasted from somewhere else); they
# are ignored, and the author is told so.
DOCUMENT_FIELDS = ("id", "name", "type")


def parse_sheet_source(
    source: str, *, name: Optional[str] = None, sheet_id: Optional[str] = None, sheet_type: Optional[str] = None,
) -> Tuple[SheetSpec, List[str]]:
    """The sheet a YAML source describes, plus warnings about things that
    parsed but are probably not what the author meant. Raises SheetParseError.

    `name`, `sheet_id` and `sheet_type` are a sheet document's own (see
    parse_sheet_doc): given, they are what the sheet is called, and an empty
    source is an empty sheet."""
    if len(source) > MAX_SOURCE_LENGTH:
        raise SheetParseError(f"A sheet can't be longer than {MAX_SOURCE_LENGTH // 1000} KB")
    try:
        data = yaml.load(source, Loader=_NoAliasLoader)  # noqa: S506 (a SafeLoader)
    except yaml.YAMLError as e:
        problem = getattr(e, "problem", None) or str(e)
        raise SheetParseError(f"Invalid YAML: {problem}")
    except (ValueError, TypeError, LookupError, AttributeError, OverflowError, RecursionError) as e:
        # What PyYAML's constructors let through on a scalar they can't build
        # (`2024-13-45`, `!!bool maybe`) or a document nested past the stack: the
        # sheet's YAML is wrong, not the server.
        raise SheetParseError(f"Invalid YAML: {e}")
    in_document = name is not None
    if data is None and in_document:
        data = {}
    if not isinstance(data, dict):
        raise SheetParseError("A sheet must be a YAML mapping (subtitle: ..., sections: ...)")
    if "resources" in data:
        raise SheetParseError("'resources' is gone: counters go in a section, as its `counters` (the same name: max mapping)")

    warnings = [f"Unknown field '{key}'" for key in data if str(key) not in KNOWN_FIELDS]
    if in_document:
        warnings += [
            f"'{key}' is ignored here: the sheet's {key} is its document's" for key in DOCUMENT_FIELDS if key in data
        ]
        data = {**{k: v for k, v in data.items() if k not in DOCUMENT_FIELDS}, "name": name, "type": sheet_type}

    name = _text(data.get("name"))
    if not name:
        raise SheetParseError("A sheet needs a name")
    sheet_type = (_text(data.get("type")) or "adversary").lower()
    if sheet_type not in SHEET_TYPES:
        raise SheetParseError(f"type must be one of: {', '.join(SHEET_TYPES)}")

    explicit_id = sheet_id or slugify(_text(data.get("id")) or "")
    sheet_id = explicit_id or slugify(name)
    if not sheet_id:
        raise SheetParseError("The sheet's id needs at least one letter or number")
    if sheet_type == "character" and not explicit_id:
        warnings.append("A character should declare a stable id: its saved values are kept under it")
    image, image_warning = normalize_image(data.get("image"))
    if image_warning:
        warnings.append(image_warning)
    sections, resources = _sections(data.get("sections"))

    try:
        spec = SheetSpec(
            id=sheet_id, name=name, type=sheet_type, subtitle=_text(data.get("subtitle")), image=image,
            tags=_tags(data.get("tags")), resources=resources,
            stats=_stats(data.get("stats")), sections=sections,
            columns=_columns(data.get("columns"), "columns"), text=_text(data.get("text")),
        )
    except ValidationError as e:
        raise SheetParseError(f"Invalid sheet: {e.errors()[0]['msg']}")
    return spec, warnings


def parse_sheet_doc(doc: Dict[str, Any], sheet_type: str) -> Tuple[SheetSpec, List[str]]:
    """The sheet a character or adversary document describes."""
    return parse_sheet_source(
        doc.get("source") or "", name=doc.get("name") or "", sheet_id=doc.get("id"), sheet_type=sheet_type,
    )
