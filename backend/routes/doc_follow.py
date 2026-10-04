"""What follows a document whose id changed (it was moved, or its folder
renamed or moved): the notes that show it (`chart:<id>`, `character:<id>`...)
and, for a sheet, the encounters and maps that use it. make_doc_router's
`on_moved` for the kinds a note can show."""
import asyncio
import logging
from typing import Awaitable, Callable, Dict

from routes.notes import md_service_instance
from services.markdown_service import NoteSaveError

logger = logging.getLogger(__name__)

OnMoved = Callable[[Dict[str, str], dict], Awaitable[None]]


def following(kind: str, *also: OnMoved) -> OnMoved:
    """Rewrites the notes' links to the moved documents (one commit), then runs
    `also`. A failure is logged, not raised: the move itself already happened."""
    async def follow(moves: Dict[str, str], user: dict) -> None:
        try:
            changed = await asyncio.to_thread(
                md_service_instance.follow_moved_documents, kind, moves,
                user.get("name") or user["email"], user["email"],
            )
            if changed:
                logger.info(f"Notes now link to the moved {kind}s: {', '.join(changed)}")
        except (NoteSaveError, OSError) as e:
            logger.error(f"Could not update the notes that link to moved {kind}s: {e}")
        for hook in also:
            await hook(moves, user)
    return follow
