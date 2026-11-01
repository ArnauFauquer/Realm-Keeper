"""What follows a document whose id changed (it was moved, or its folder
renamed or moved): the notes that show it (`chart:<id>`, `character:<id>`...)
and, for a sheet, the encounters and maps that use it; for an encounter, the
maps whose tokens stand for its combatants. ON_MOVED holds it for each kind:
make_doc_router's `on_moved`, and what the Observatory's folder routes run."""
import asyncio
import logging
from typing import Dict

from routes.doc_router import OnMoved
from routes.notes import md_service_instance
from services.sheet_refs import follow_moved_encounters, follow_moved_sheets

logger = logging.getLogger(__name__)


def following(kind: str, *also: OnMoved, in_notes: bool = True) -> OnMoved:
    """Rewrites the notes' links to the moved documents (one commit), then runs
    `also`. A failure is logged, not raised: the move itself already happened,
    and one step failing (git unreachable) mustn't keep the next from running."""
    async def follow(moves: Dict[str, str], user: dict) -> None:
        if in_notes:
            try:
                changed = await asyncio.to_thread(
                    md_service_instance.follow_moved_documents, kind, moves,
                    user.get("name") or user["email"], user["email"],
                )
                if changed:
                    logger.info(f"Notes now link to the moved {kind}s: {', '.join(changed)}")
            except Exception:
                logger.exception(f"Could not update the notes that link to moved {kind}s")
        for hook in also:
            try:
                await hook(moves, user)
            except Exception:
                logger.exception(f"Could not follow moved {kind}s")
    return follow


ON_MOVED: Dict[str, OnMoved] = {
    "chart": following("chart"),
    "vista": following("vista"),
    "character": following("character", follow_moved_sheets("character")),
    "adversary": following("adversary", follow_moved_sheets("adversary")),
    # A note can't show an encounter: only the maps follow it.
    "encounter": following("encounter", follow_moved_encounters, in_notes=False),
}
