"""Encounters and maps name the sheets they use by id: a combatant by its
`type` and `sheet`, a token by its `sheet`. When characters or adversaries are
moved (their ids change), these follow."""
import asyncio
import logging
from typing import Dict, List

from services.doc_registry import battlemap_collection, encounter_collection, hub

logger = logging.getLogger(__name__)


def rename_sheet_refs(entities: List[dict], moves: Dict[str, str], sheet_type: str = None) -> None:
    """Points the entities naming a moved sheet at its new id. With
    `sheet_type`, only the ones of that type (combatants have one)."""
    for entity in entities:
        new_id = moves.get(entity.get("sheet"))
        if new_id and (sheet_type is None or entity.get("type", "adversary") == sheet_type):
            entity["sheet"] = new_id


def follow_moved_sheets(sheet_type: str):
    """make_doc_router's `on_moved` for a kind of sheet. An encounter or map
    that can't take the change (a character already in that encounter under
    its new id) is left as it was, and logged."""
    async def follow(moves: Dict[str, str], user: dict) -> None:
        for kind, collection, field, typed in (
            ("encounter", encounter_collection, "combatants", True),
            ("battlemap", battlemap_collection, "tokens", False),
        ):
            for meta in await asyncio.to_thread(collection.list_all):
                try:
                    await hub.mutate(
                        kind, meta.id,
                        lambda d, f=field, t=typed: rename_sheet_refs(d.get(f, []), moves, sheet_type if t else None),
                        user=user, command=f"follow_moved_{sheet_type}",
                    )
                except ValueError as e:
                    logger.warning(f"{kind} {meta.id} still names a moved {sheet_type}: {e}")
    return follow
