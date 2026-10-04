import asyncio
import logging

from routes.doc_router import make_doc_router
from services.doc_registry import CHARACTER, battlemap_collection, characters_collection, encounter_collection, hub

logger = logging.getLogger(__name__)


def _rename_sheet(entities, old_id: str, new_id: str, only_characters: bool) -> None:
    for entity in entities:
        if entity.get("sheet") == old_id and (not only_characters or entity.get("type") == "character"):
            entity["sheet"] = new_id


async def follow_reassigned_character(old_id: str, new_id: str, user: dict) -> None:
    """A character was given another id: the encounters it is in, and the map
    tokens that stand for it, now name it by the new one. One that can't (the
    new id is already in that encounter) is left as it was, and logged."""
    for kind, collection, field, only_characters in (
        ("encounter", encounter_collection, "combatants", True),
        ("battlemap", battlemap_collection, "tokens", False),
    ):
        for meta in await asyncio.to_thread(collection.list_all):
            try:
                await hub.mutate(
                    kind, meta.id, lambda d, f=field, o=only_characters: _rename_sheet(d.get(f, []), old_id, new_id, o),
                    user=user, command="reassign_character",
                )
            except ValueError as e:
                logger.warning(f"{kind} {meta.id} still names the character '{old_id}': {e}")


router = make_doc_router(CHARACTER, characters_collection, hub, on_reassign=follow_reassigned_character)
