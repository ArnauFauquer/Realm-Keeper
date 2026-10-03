"""Live documents: the ones several people edit at once and watch change.

A live document (an encounter, the characters' state) is held in memory while
anybody is using it. It changes only through `mutate`, which applies an edit to
a copy, validates the result, bumps the document's `rev`, and tells every
connected client what changed; clients never write a whole document, so two
people moving different tokens, or both hitting a counter, don't undo each
other. The server runs a single process, so this one lock per document is all
the coordination needed.

Persistence is behind the same door: after a quiet moment (or at most
FLUSH_MAX_WAIT seconds) a changed document is written to its DocBackend, and
once more when the app shuts down. `mutate` is also where an `authorize` check
and, later, automations ("when a counter reaches...") belong: every change to a
live document passes through it.
"""
import asyncio
import copy
import json
import logging
import time
from typing import Any, Callable, Dict, List, Optional, Tuple

from fastapi import WebSocket
from pydantic import ValidationError

from services.doc_collection import DocCollection, DocNotFound, _first_error
from services.doc_type import DocType, validate_library_urls

logger = logging.getLogger(__name__)

FLUSH_DELAY = 2.0          # seconds of quiet before a changed document is written
FLUSH_MAX_WAIT = 15.0      # ... but never wait longer than this under constant edits
FLUSH_RETRY_DELAY = 5.0
IDLE_UNLOAD_SECONDS = 600  # an untouched, saved document leaves memory
MAX_DOC_BYTES = 1_000_000
MAX_SYNC_CONNECTIONS = 100
SEND_TIMEOUT = 2.0

# Changes of these fields aren't reported to clients: `rev` travels on the
# event itself, and a client has no use for the time of the last save.
UNREPORTED_FIELDS = {"rev", "updated_at"}


def _is_entity_list(*values: Any) -> bool:
    return all(
        isinstance(value, list) and all(isinstance(e, dict) and isinstance(e.get("id"), str) for e in value)
        for value in values
    )


def diff_docs(old: Dict[str, Any], new: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """What changed from `old` to `new`, as a client can apply it, or None.
    Lists of {id: ...} entities are compared entity by entity (`upsert`,
    `remove`, and `order` when their sequence changed); any other field that
    differs is `set` whole."""
    set_fields: Dict[str, Any] = {}
    upsert: Dict[str, List[Any]] = {}
    remove: Dict[str, List[str]] = {}
    order: Dict[str, List[str]] = {}
    for key in sorted((old.keys() | new.keys()) - UNREPORTED_FIELDS):
        before, after = old.get(key), new.get(key)
        if before == after:
            continue
        if _is_entity_list(before or [], after or []):
            before, after = before or [], after or []
            known = {e["id"]: e for e in before}
            changed = [e for e in after if known.get(e["id"]) != e]
            gone = [i for i in known if i not in {e["id"] for e in after}]
            if changed:
                upsert[key] = changed
            if gone:
                remove[key] = gone
            if [e["id"] for e in before] != [e["id"] for e in after]:
                order[key] = [e["id"] for e in after]
        else:
            set_fields[key] = after
    event = {k: v for k, v in (("set", set_fields), ("upsert", upsert), ("remove", remove), ("order", order)) if v}
    return event or None


class Room:
    def __init__(self, doctype: DocType, doc_id: str, data: Dict[str, Any]):
        self.doctype = doctype
        self.doc_id = doc_id
        self.data = data
        self.persisted_rev = data.get("rev", 0)
        self.dirty = False
        self.first_dirty_at = 0.0
        self.flush_handle: Optional[asyncio.TimerHandle] = None
        self.lock = asyncio.Lock()
        self.flush_lock = asyncio.Lock()
        self.last_used = time.monotonic()

    @property
    def ref(self) -> str:
        return f"{self.doctype.kind}:{self.doc_id}"


def _persist(collection: DocCollection, doc_id: str, data: Dict[str, Any], persisted_rev: int) -> Optional[Dict[str, Any]]:
    """Writes `data`, unless the stored document is already ahead of what this
    process last saw (another process wrote it): then returns that one instead
    and leaves it alone."""
    stored = collection.read_raw(doc_id)
    if stored is not None and stored.get("rev", 0) > persisted_rev:
        return stored
    collection.write_raw(doc_id, data)
    return None


class DocHub:
    def __init__(self, collections: Dict[str, DocCollection]):
        self._collections = collections
        self._rooms: Dict[Tuple[str, str], Room] = {}
        self._loading: Dict[Tuple[str, str], "asyncio.Future[Room]"] = {}
        self._sockets: List[WebSocket] = []
        # The event loop keeps only weak references to tasks: hold the ones
        # started by a timer until they finish.
        self._tasks: set = set()
        # Told of every event once it has been sent (the screens' view of a
        # battlemap is kept current this way).
        self._listeners: List[Callable[[Dict[str, Any]], Any]] = []

    def add_listener(self, listener: Callable[[Dict[str, Any]], Any]) -> None:
        """`listener(event)`, a coroutine function, is awaited after every
        event, outside the document's lock: it must be quick."""
        self._listeners.append(listener)

    async def _notify(self, event: Dict[str, Any]) -> None:
        for listener in self._listeners:
            try:
                await listener(event)
            except Exception:
                logger.exception("A sync listener failed")

    def _spawn(self, coro) -> None:
        task = asyncio.ensure_future(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    # ── connections ─────────────────────────────────────────────────────

    def connect(self, websocket: WebSocket) -> bool:
        if len(self._sockets) >= MAX_SYNC_CONNECTIONS:
            return False
        self._sockets.append(websocket)
        return True

    def disconnect(self, websocket: WebSocket) -> None:
        if websocket in self._sockets:
            self._sockets.remove(websocket)

    async def _send(self, websocket: WebSocket, event: Dict[str, Any]) -> None:
        try:
            await asyncio.wait_for(websocket.send_json(event), SEND_TIMEOUT)
        except Exception as e:
            # One that can't be written to is gone; dropping it keeps the
            # rest in step and frees its place in the connection limit.
            logger.info(f"Dropping a sync connection: {e!r}")
            self.disconnect(websocket)

    async def _broadcast(self, event: Dict[str, Any]) -> None:
        # All at once: a phone that went to sleep without closing its socket
        # makes its send wait out SEND_TIMEOUT, and one after another each such
        # client would hold up every change (the document's lock is held while
        # this runs) by that long.
        await asyncio.gather(*(self._send(websocket, event) for websocket in list(self._sockets)))

    # ── rooms ───────────────────────────────────────────────────────────

    def authorize(self, user: Optional[dict], ref: str, command: str) -> bool:
        """Whether `user` may run `command` on the document `ref`. Everyone who
        is signed in may do anything, for now; roles would be checked here."""
        return True

    async def _load(self, kind: str, doc_id: str) -> Room:
        collection = self._collections[kind]
        doctype = collection.doctype
        raw = await asyncio.to_thread(collection.read_raw, doc_id)
        if raw is None:
            if doctype.singleton != doc_id:
                raise DocNotFound(f"{kind.capitalize()} not found: {doc_id}")
            raw = {"id": doc_id}
        data = doctype.model.model_validate(raw).model_dump(mode="json")
        room = Room(doctype, doc_id, data)
        self._rooms[(kind, doc_id)] = room
        return room

    async def _room(self, kind: str, doc_id: str) -> Room:
        key = (kind, doc_id)
        room = self._rooms.get(key)
        if room is not None:
            room.last_used = time.monotonic()
            return room
        pending = self._loading.get(key)
        if pending is None:
            pending = asyncio.ensure_future(self._load(kind, doc_id))
            self._loading[key] = pending
            pending.add_done_callback(lambda _f, k=key: self._loading.pop(k, None))
        return await pending

    async def snapshot(self, kind: str, doc_id: str) -> Dict[str, Any]:
        room = await self._room(kind, doc_id)
        return copy.deepcopy(room.data)

    async def mutate(
        self, kind: str, doc_id: str, fn: Callable[[Dict[str, Any]], None],
        user: Optional[dict] = None, command: str = "",
    ) -> Optional[Dict[str, Any]]:
        """Applies `fn` (which edits the dict it is given) to the document,
        and returns the event every client received, or None if nothing
        changed. ValueError: `fn` or the validation refused the edit."""
        room = await self._room(kind, doc_id)
        if not self.authorize(user, room.ref, command):
            raise PermissionError(command)
        async with room.lock:
            edited = copy.deepcopy(room.data)
            fn(edited)
            edited["id"] = room.data["id"]
            try:
                validated = room.doctype.model.model_validate(edited).model_dump(mode="json")
            except ValidationError as e:
                raise ValueError(_first_error(e))
            validate_library_urls(validated, room.doctype)
            event = diff_docs(room.data, validated)
            if event is None:
                return None
            validated["rev"] = room.data.get("rev", 0) + 1
            if len(json.dumps(validated)) > MAX_DOC_BYTES:
                raise ValueError("The document is too large")
            room.data = validated
            room.last_used = time.monotonic()
            self._schedule_flush(room)
            event = {"type": "doc", "doc": room.ref, "rev": validated["rev"], **event}
            # Sent before the lock is released, so events leave in `rev` order.
            await self._broadcast(event)
        await self._notify(event)
        return event

    # ── persistence ─────────────────────────────────────────────────────

    def _schedule_flush(self, room: Room, delay: Optional[float] = None) -> None:
        loop = asyncio.get_running_loop()
        now = loop.time()
        if not room.dirty:
            room.dirty = True
            room.first_dirty_at = now
        if room.flush_handle is not None:
            room.flush_handle.cancel()
        if delay is None:
            delay = min(FLUSH_DELAY, max(0.0, FLUSH_MAX_WAIT - (now - room.first_dirty_at)))
        room.flush_handle = loop.call_later(delay, lambda: self._spawn(self._flush(room)))

    async def _flush(self, room: Room) -> None:
        async with room.flush_lock:
            if room.flush_handle is not None:
                room.flush_handle.cancel()
                room.flush_handle = None
            if not room.dirty:
                return
            room.dirty = False
            data = copy.deepcopy(room.data)
            collection = self._collections[room.doctype.kind]
            try:
                newer = await asyncio.to_thread(_persist, collection, room.doc_id, data, room.persisted_rev)
            except Exception:
                logger.exception(f"Could not save {room.ref}; will retry")
                self._schedule_flush(room, FLUSH_RETRY_DELAY)
                return
            if newer is None:
                room.persisted_rev = data.get("rev", 0)
                return
            # Another process saved a newer version: it wins. Take it, and have
            # every client reload rather than guess how the two fit together.
            logger.warning(f"{room.ref} was changed elsewhere; reloading it")
            async with room.lock:
                room.data = room.doctype.model.model_validate(newer).model_dump(mode="json")
                room.persisted_rev = room.data.get("rev", 0)
                room.dirty = False
            await self._broadcast({"type": "doc", "doc": room.ref, "reset": True})

    async def flush_all(self) -> None:
        for room in list(self._rooms.values()):
            await self._flush(room)

    async def forget(self, kind: str, doc_id: str, announce: bool = True) -> None:
        """Saves a document and lets go of it: the document is about to be
        moved or deleted, so clients still showing it are told it is gone."""
        room = self._rooms.get((kind, doc_id))
        if room is None:
            return
        await self._flush(room)
        self._rooms.pop((kind, doc_id), None)
        if announce:
            event = {"type": "gone", "doc": room.ref}
            await self._broadcast(event)
            await self._notify(event)

    def discard(self, kind: str, doc_id: str) -> None:
        """Lets go of a document's room *without* saving it. For after a
        document was deleted or moved: a command that reached it between
        `forget` and the move would have loaded it again from the old place,
        and its pending save would put the document back there."""
        room = self._rooms.pop((kind, doc_id), None)
        if room is not None:
            if room.flush_handle is not None:
                room.flush_handle.cancel()
                room.flush_handle = None
            room.dirty = False

    async def unload_idle(self) -> None:
        now = time.monotonic()
        for key, room in list(self._rooms.items()):
            if not room.dirty and not room.flush_lock.locked() and now - room.last_used > IDLE_UNLOAD_SECONDS:
                self._rooms.pop(key, None)

    async def run_housekeeping(self) -> None:
        while True:
            await asyncio.sleep(60)
            await self.unload_idle()
