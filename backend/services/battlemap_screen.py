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
        # How many projections of each map were asked for. One computed before
        # the last (a map shown, then a token hidden a moment later) is not
        # sent once a newer one is on its way: it could reach the screens
        # after it, and show the hidden token again.
        self._generations: Dict[str, int] = {}

    async def _fresh_projection(self, battlemap_id: str) -> Optional[Dict[str, Any]]:
        """The map's projection, or None if a newer one was asked for meanwhile."""
        generation = self._generations[battlemap_id] = self._generations.get(battlemap_id, 0) + 1
        projection = await self.projection(battlemap_id)
        return projection if self._generations.get(battlemap_id) == generation else None

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
            except ValueError:
                # Gone (DocNotFound), or not a valid id at all: the map is
                # still shown, just without anyone's counters.
                pass
        characters = {}
        for combatant in (encounter or {}).get("combatants", []):
            if combatant.get("type") == "character" and combatant.get("sheet"):
                try:
                    characters[combatant["sheet"]] = await self.hub.snapshot("character", combatant["sheet"])
                except ValueError:
                    pass   # not saved yet (or gone): no counters to show
        return project_for_screen(battlemap, encounter, characters)

    async def show(self, battlemap_id: str) -> None:
        """Raises ValueError if there is no such battlemap (DocNotFound), or no
        such id could name one."""
        # Made again if a newer one was asked for while it was being made (the
        # map is being changed as it is shown); the last try is sent anyway.
        for _ in range(3):
            projection = await self._fresh_projection(battlemap_id)
            if projection is not None:
                break
        else:
            projection = await self.projection(battlemap_id)
        await self.manager.broadcast(
            {"type": "display_battlemap", "battlemap_id": battlemap_id},
            {"type": "update_battlemap", **projection},
        )

    async def relay_signal(self, battlemap: Dict[str, Any], signal: Dict[str, Any]) -> bool:
        """Shows a signal (a ping, the pointer, a roll over a token) on the
        screens, if the map is the one they show. A roll over a hidden token
        doesn't reach them, as the token itself doesn't. True if it was sent."""
        if self.displayed() != battlemap["id"]:
            return False
        if signal.get("token"):
            token = next((t for t in battlemap.get("tokens", []) if t["id"] == signal["token"]), None)
            if token is None or token.get("hidden"):
                return False
        public = {key: value for key, value in signal.items() if key != "source"}
        await self.manager.broadcast({**public, "type": "battlemap_signal", "battlemap_id": battlemap["id"]})
        return True

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
        elif kind == "character":
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
            projection = await self._fresh_projection(displayed)
            if projection is not None and self.displayed() == displayed:
                await self.manager.broadcast({"type": "update_battlemap", **projection})
        except Exception:
            logger.exception("Could not update the battlemap on the screens")
