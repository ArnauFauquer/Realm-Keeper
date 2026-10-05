"""Encounters and maps name the documents they use by id: a combatant its
sheet by `type` and `sheet`, a token its sheet by `sheet` (and its combatant,
whose type it is), a map its encounter by `encounter`. When those documents are
moved (their ids change), these follow."""
import asyncio
import logging
from typing import Any, Callable, Dict, List, Optional

from services.doc_collection import DocCollection
from services.doc_registry import battlemap_collection, encounter_collection, hub

logger = logging.getLogger(__name__)


def rename_sheet_refs(
    entities: List[dict], moves: Dict[str, str], sheet_type: str = None,
    type_of: Optional[Callable[[dict], Optional[str]]] = None,
) -> None:
    """Points the entities naming a moved sheet at its new id. With
    `sheet_type`, only the ones of that type: an entity's type is
    `type_of(entity)` (by default its own `type`, as a combatant has one), and
    one whose type can't be told (None) follows too."""
    type_of = type_of or (lambda entity: entity.get("type", "adversary"))
    for entity in entities:
        new_id = moves.get(entity.get("sheet"))
        if new_id and (sheet_type is None or type_of(entity) in (sheet_type, None)):
            entity["sheet"] = new_id


async def _stored(kind: str, collection: DocCollection, doc_id: str) -> Optional[Dict[str, Any]]:
    """The document as it is now: in memory if the hub holds it, else as stored
    (without loading it into the hub)."""
    held = hub.held(kind, doc_id)
    if held is not None:
        return held
    try:
        return await asyncio.to_thread(collection.read_raw, doc_id)
    except ValueError:
        return None   # unreadable: nothing to follow in it


async def _each(kind: str, collection: DocCollection):
    keys = await asyncio.to_thread(collection.backend.list_keys, collection.root)
    for doc_id in collection.ids(keys):
        doc = await _stored(kind, collection, doc_id)
        if doc is not None:
            yield doc_id, doc


async def _change(kind: str, doc_id: str, fn: Callable[[Dict[str, Any]], None], user: dict, what: str) -> None:
    """Changes one of them through the hub, like any edit. One that can't take
    the change (a character already in that encounter under its new id) is
    left as it was, and logged."""
    try:
        await hub.mutate(kind, doc_id, fn, user=user, command=f"follow_moved_{what}")
    except ValueError as e:
        logger.warning(f"{kind} {doc_id} still names a moved {what}: {e}")


async def _combatant_types(encounter_id: Optional[str]) -> Dict[str, str]:
    """{combatant id: its sheet's type} in the encounter a map's tokens stand for."""
    encounter = await _stored("encounter", encounter_collection, encounter_id) if encounter_id else None
    return {c.get("id"): c.get("type", "adversary") for c in (encounter or {}).get("combatants", [])}


def follow_moved_sheets(sheet_type: str):
    """make_doc_router's `on_moved` for a kind of sheet. Only the encounters
    and maps that name a moved sheet are changed (and so held by the hub)."""
    async def follow(moves: Dict[str, str], user: dict) -> None:
        def names_one(entities: List[dict]) -> bool:
            return any(entity.get("sheet") in moves for entity in entities)

        async for doc_id, encounter in _each("encounter", encounter_collection):
            if names_one(encounter.get("combatants", [])):
                await _change(
                    "encounter", doc_id,
                    lambda d: rename_sheet_refs(d.get("combatants", []), moves, sheet_type), user, sheet_type,
                )
        async for doc_id, battlemap in _each("battlemap", battlemap_collection):
            if names_one(battlemap.get("tokens", [])):
                # A character and an adversary may share an id: a token is of
                # the type of the combatant it stands for.
                types = await _combatant_types(battlemap.get("encounter"))
                await _change(
                    "battlemap", doc_id,
                    lambda d, t=types: rename_sheet_refs(
                        d.get("tokens", []), moves, sheet_type, type_of=lambda token: t.get(token.get("combatant")),
                    ),
                    user, sheet_type,
                )
    return follow


async def follow_moved_encounters(moves: Dict[str, str], user: dict) -> None:
    """make_doc_router's `on_moved` for encounters: the maps whose tokens stand
    for a moved encounter's combatants follow it."""
    async for doc_id, battlemap in _each("battlemap", battlemap_collection):
        new_id = moves.get(battlemap.get("encounter"))
        if new_id:
            await _change("battlemap", doc_id, lambda d, n=new_id: d.update(encounter=n), user, "encounter")
