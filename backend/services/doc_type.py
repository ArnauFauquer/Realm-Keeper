"""What one kind of document is: where it lives, its model, and the few rules
that differ from the next kind. Everything else — folders, create, rename,
move, delete, the HTTP routes — is written once (DocCollection,
routes/doc_router.py) and parametrized by this: every kind is declared in
services/doc_registry.py."""
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Iterator, Mapping, Optional, Tuple, Type

from pydantic import BaseModel

from services.storage_service import IMAGE_URL_PREFIX


@dataclass(frozen=True)
class DocType:
    kind: str                       # "encounter": its files end in ".encounter.json"
    prefix: str                     # "encounters": its URL under /api/
    model: Type[BaseModel]          # the whole document
    metadata_model: Type[BaseModel]  # what a gallery needs of it
    items_key: str                  # the list's name in a listing: {"folders": [...], "encounters": [...]}
    # Fields a save keeps from the stored document rather than from the request
    # (set through their own route, so they can be checked: see asset_routes).
    locked_fields: Tuple[str, ...] = ()
    # Paths of fields holding an image, which must be Observatory images:
    # "image_url", "tokens[].image_url".
    image_fields: Tuple[str, ...] = ()
    # Route name -> field: POST /<id>/image sets "image_url" to an Observatory image.
    asset_routes: Mapping[str, str] = field(default_factory=dict)
    # A live document is held in memory and edited by commands that every
    # client sees as they happen (services/sync_hub.py), instead of being
    # loaded, edited and saved whole.
    live: bool = False
    collections: Tuple[str, ...] = ()   # lists of {id: ...} entities commands may edit
    patchable: Tuple[str, ...] = ()     # top-level fields a command may set
    # A field of counters ({name: {current, max, min}}) of the document itself,
    # changed by POST /<id>/adjust as an entity's are by .../<entity>/adjust.
    resources_field: Optional[str] = None
    # Where these documents lived before the document store: a directory of the
    # vault (git), laid out as <legacy_dir>/<folders>/<slug>/<kind>.json.
    # Copied over once, at startup (DocCollection.import_legacy).
    legacy_dir: Optional[str] = None
    # Called on every document about to be stored (made, saved, or changed by
    # a command) with what was stored before (None for a new one): it may fill
    # in fields derived from others, and raises ValueError to refuse it. A
    # character's counters follow its sheet this way (services/sheet_docs.py).
    prepare: Optional[Callable[[Dict[str, Any], Optional[Dict[str, Any]]], None]] = None

    @property
    def suffix(self) -> str:
        """How the name of one of its files ends: ".encounter.json"."""
        return f".{self.kind}.json"

    @property
    def reserved_names(self) -> Tuple[str, ...]:
        """Slugs a document can't have: they'd read as a route under its id."""
        return (*self.collections, *self.asset_routes, "order", "adjust", "all", "move", "rename", "folders")


def _values_at(node: Any, parts: Tuple[str, ...]) -> Iterator[Any]:
    if not parts:
        yield node
        return
    head, rest = parts[0], parts[1:]
    if head.endswith("[]"):
        items = node.get(head[:-2]) if isinstance(node, dict) else None
        for item in items or []:
            yield from _values_at(item, rest)
    elif isinstance(node, dict):
        yield from _values_at(node.get(head), rest)


def validate_library_urls(doc: Dict[str, Any], doctype: DocType) -> None:
    """Every image a document draws must be an Observatory image: those are
    what a paired screen is allowed to read (routes/screen_access.py), and
    nothing else may be fetched on a viewer's behalf."""
    for path in doctype.image_fields:
        for value in _values_at(doc, tuple(path.split("."))):
            if value and not (isinstance(value, str) and value.startswith(IMAGE_URL_PREFIX)):
                raise ValueError("Images must be images from the Observatory")
