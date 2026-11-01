"""A set of WebSockets that are all sent the same messages: the live documents'
(/ws/sync, services/sync_hub.py) and the screens' (/ws/screen, routes/screen.py).

Sending is to all of them at once, each with a time limit: a phone that went
to sleep without closing its socket, or a TV switched off at the wall, would
otherwise hold up every message (and whoever waits for it) until the
connection times out, tens of seconds later. One that can't be written to is
dropped and closed, so it frees its place and its client, if it is only slow,
reconnects and catches up."""
import asyncio
import contextlib
import logging
from typing import Any, Dict, List

from fastapi import WebSocket

logger = logging.getLogger(__name__)

SEND_TIMEOUT = 2.0


class SocketGroup:
    def __init__(self, name: str, limit: int, send_timeout: float = SEND_TIMEOUT):
        self.name = name
        self.limit = limit
        self.send_timeout = send_timeout
        self.sockets: List[WebSocket] = []
        # The event loop keeps only weak references to tasks: hold the closes
        # under way until they finish.
        self._tasks: set = set()

    def __len__(self) -> int:
        return len(self.sockets)

    def add(self, websocket: WebSocket) -> bool:
        """False if the group is full."""
        if len(self.sockets) >= self.limit:
            return False
        self.sockets.append(websocket)
        return True

    def remove(self, websocket: WebSocket) -> None:
        if websocket in self.sockets:
            self.sockets.remove(websocket)

    async def send(self, websocket: WebSocket, message: Dict[str, Any]) -> bool:
        """Sends to one; drops and closes it if it can't be written to."""
        try:
            await asyncio.wait_for(websocket.send_json(message), self.send_timeout)
            return True
        except Exception as e:
            logger.info(f"Dropping a {self.name} connection: {e!r}")
            self.remove(websocket)
            task = asyncio.ensure_future(self._close(websocket))
            self._tasks.add(task)
            task.add_done_callback(self._tasks.discard)
            return False

    async def _close(self, websocket: WebSocket) -> None:
        with contextlib.suppress(Exception):
            await asyncio.wait_for(websocket.close(code=1011), self.send_timeout)

    async def broadcast(self, message: Dict[str, Any]) -> None:
        await asyncio.gather(*(self.send(websocket, message) for websocket in list(self.sockets)))
