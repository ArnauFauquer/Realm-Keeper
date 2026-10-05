"""Every sheet there is: the character and adversary documents, read. What an
encounter is filled from, and what it shows a combatant's sheet with."""
import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, List, Optional

from models.sheet import SheetCatalogEntry
from services.doc_collection import DocCollection
from services.doc_registry import adversary_collection, characters_collection, hub
from services.sheet_parser import SheetParseError, parse_sheet_doc

logger = logging.getLogger(__name__)

COLLECTIONS: Dict[str, DocCollection] = {"character": characters_collection, "adversary": adversary_collection}


def _read(sheet_type: str, doc_id: str) -> Optional[Dict[str, Any]]:
    """A character's latest values may be in memory, not yet stored."""
    held = hub.held(sheet_type, doc_id)
    if held is not None:
        return held
    try:
        return COLLECTIONS[sheet_type].read_raw(doc_id)
    except ValueError:
        return None


def _entry(sheet_type: str, doc: Optional[Dict[str, Any]]) -> Optional[SheetCatalogEntry]:
    if doc is None:
        return None
    try:
        sheet, warnings = parse_sheet_doc(doc, sheet_type)
    except SheetParseError as e:
        logger.warning(f"The {sheet_type} {doc.get('id')} isn't a valid sheet: {e}")
        return None
    return SheetCatalogEntry(ref=doc["id"], type=sheet_type, sheet=sheet, warnings=warnings)


def get_sheet(sheet_type: str, ref: str) -> Optional[SheetCatalogEntry]:
    if sheet_type not in COLLECTIONS:
        return None
    return _entry(sheet_type, _read(sheet_type, ref))


def list_sheets(sheet_type: Optional[str] = None) -> List[SheetCatalogEntry]:
    """Every valid sheet (of one type), by name. Each is read once: the store
    is listed (once for both kinds, which share it), not read for metadata
    first and then again for the sheet."""
    listed: Dict[tuple, List[str]] = {}
    wanted = []
    for t, collection in COLLECTIONS.items():
        if sheet_type in (None, t):
            where = (id(collection.backend), collection.root)
            if where not in listed:
                listed[where] = collection.backend.list_keys(collection.root)
            wanted.extend((t, doc_id) for doc_id in collection.ids(listed[where]))
    with ThreadPoolExecutor(max_workers=8) as pool:
        entries = [e for e in pool.map(lambda key: get_sheet(*key), wanted) if e is not None]
    entries.sort(key=lambda e: (e.sheet.name.lower(), e.type))
    return entries
