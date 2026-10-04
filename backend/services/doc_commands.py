"""The edits a live document accepts, as plain functions on its dict. Each one
only changes the dict (SyncHub.mutate validates the result and tells everyone);
a ValueError is the caller's mistake."""
import copy
import uuid
from typing import Any, Dict, List

from services.doc_type import DocType


def new_id() -> str:
    return uuid.uuid4().hex[:8]


def _entities(doc: Dict[str, Any], doctype: DocType, collection: str) -> List[Dict[str, Any]]:
    if collection not in doctype.collections:
        raise ValueError(f"Unknown collection: {collection}")
    return doc.setdefault(collection, [])


def _find(entities: List[Dict[str, Any]], entity_id: str) -> Dict[str, Any]:
    for entity in entities:
        if entity.get("id") == entity_id:
            return entity
    raise ValueError(f"Not found: {entity_id}")


def deep_merge(target: Dict[str, Any], patch: Dict[str, Any]) -> None:
    """Merges `patch` into `target`: mappings merge key by key, anything else
    (including null) replaces."""
    for key, value in patch.items():
        if isinstance(value, dict) and isinstance(target.get(key), dict):
            deep_merge(target[key], value)
        else:
            target[key] = copy.deepcopy(value)


def patch_doc(doc: Dict[str, Any], doctype: DocType, fields: Dict[str, Any]) -> None:
    """Sets top-level fields; a mapping (a map's grid) is merged into the
    current one, so changing one setting leaves the others as they are."""
    for name in fields:
        if name not in doctype.patchable:
            raise ValueError(f"'{name}' can't be set this way")
    deep_merge(doc, fields)


def add_items(
    doc: Dict[str, Any], doctype: DocType, collection: str, items: List[Dict[str, Any]], ignore_existing: bool = False,
) -> None:
    entities = _entities(doc, doctype, collection)
    present = {e.get("id") for e in entities}
    for item in items:
        entity = copy.deepcopy(item)
        entity["id"] = str(entity.get("id") or new_id())
        if entity["id"] in present:
            if ignore_existing:
                continue
            raise ValueError(f"Already exists: {entity['id']}")
        entities.append(entity)
        present.add(entity["id"])


def patch_item(doc: Dict[str, Any], doctype: DocType, collection: str, entity_id: str, patch: Dict[str, Any]) -> None:
    entity = _find(_entities(doc, doctype, collection), entity_id)
    if "id" in patch and patch["id"] != entity_id:
        raise ValueError("An id can't be changed")
    deep_merge(entity, patch)


def remove_item(doc: Dict[str, Any], doctype: DocType, collection: str, entity_id: str) -> None:
    entities = _entities(doc, doctype, collection)
    _find(entities, entity_id)
    entities[:] = [e for e in entities if e.get("id") != entity_id]


def order_items(doc: Dict[str, Any], doctype: DocType, collection: str, ids: List[str]) -> None:
    """Puts the listed entities first, in that order; the rest follow as they were."""
    entities = _entities(doc, doctype, collection)
    by_id = {e.get("id"): e for e in entities}
    unknown = [i for i in ids if i not in by_id]
    if unknown:
        raise ValueError(f"Not found: {unknown[0]}")
    listed = [by_id[i] for i in dict.fromkeys(ids)]
    entities[:] = listed + [e for e in entities if e.get("id") not in set(ids)]


def adjust_resource(
    doc: Dict[str, Any], doctype: DocType, collection: str, entity_id: str, resource: str, by: int,
) -> None:
    """Adds `by` to a counter, stopping at its min and max. A relative change,
    not a new value, so two people changing the same counter at once both
    count."""
    entity = _find(_entities(doc, doctype, collection), entity_id)
    counter = (entity.get("resources") or {}).get(resource)
    if counter is None:
        raise ValueError(f"No resource '{resource}'")
    counter["current"] = max(counter.get("min", 0), min(counter["max"], counter["current"] + by))
