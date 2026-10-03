"""Keeps the screens' view of the displayed battlemap current.

Showing a battlemap sends the screens a pointer (`display_battlemap`) and its
projection (`update_battlemap`, see battlemap_projection.py); from then on every
change to the map, to the encounter its tokens stand for, or to the characters'
counters sends a fresh projection, a moment later and at most once per
COALESCE seconds, so dragging a token doesn't flood them.
"""
import asyncio
import logging
from typing import Any, Dict, Optional

from services.battlemap_projection import project_for_screen
from services.doc_collection import DocNotFound
from services.sync_hub import DocHub

logger = logging.getLogger(__name__)

COALESCE = 0.08


class BattlemapScreen:
    def __init__(self, hub: DocHub, manager):
        self.hub = hub
        self.manager = manager
        self._pending = False
        self._tasks: set = set()

    def displayed(self) -> Optional[str]:
        state = self.manager.current_state or {}
        value = state.get("battlemap_id") if state.get("type") == "display_battlemap" else None
        return value.strip("/") if isinstance(value, str) else None

    async def projection(self, battlemap_id: str) -> Dict[str, Any]:
        battlemap = await self.hub.snapshot("battlemap", battlemap_id)
        encounter = None
        if battlemap.get("encounter"):
            try:
                encounter = await self.hub.snapshot("encounter", battlemap["encounter"])
            except DocNotFound:
                pass
        characters = await self.hub.snapshot("characters", "all")
        return project_for_screen(battlemap, encounter, characters)

    async def show(self, battlemap_id: str) -> None:
        """Raises DocNotFound if there is no such battlemap."""
        projection = await self.projection(battlemap_id)
        await self.manager.broadcast({"type": "display_battlemap", "battlemap_id": battlemap_id})
        await self.manager.broadcast({"type": "update_battlemap", **projection})

    async def on_event(self, event: Dict[str, Any]) -> None:
        """Called by the hub after every change to a live document."""
        displayed = self.displayed()
        if not displayed:
            return
        kind, _, doc_id = event.get("doc", "").partition(":")
        if event.get("type") == "gone":
            if (kind, doc_id) == ("battlemap", displayed):
                await self.manager.broadcast({"type": "clear_screen"})
            return
        if kind == "battlemap" and doc_id == displayed:
            self._schedule()
        elif kind == "characters":
            self._schedule()
        elif kind == "encounter":
            try:
                battlemap = await self.hub.snapshot("battlemap", displayed)
            except DocNotFound:
                return
            if battlemap.get("encounter") == doc_id:
                self._schedule()

    def _schedule(self) -> None:
        if self._pending:
            return
        self._pending = True
        task = asyncio.ensure_future(self._push_later())
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _push_later(self) -> None:
        await asyncio.sleep(COALESCE)
        self._pending = False
        displayed = self.displayed()
        if not displayed:
            return
        try:
            await self.manager.broadcast({"type": "update_battlemap", **await self.projection(displayed)})
        except Exception:
            logger.exception("Could not update the battlemap on the screens")
