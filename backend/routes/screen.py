import asyncio
from fastapi import APIRouter, Depends, HTTPException, Response, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, ConfigDict, Field, model_validator
from typing import List, Literal, Dict, Optional, Tuple
from config.logging import get_logger
from config.settings import settings
from models.chart import Annotation, ChartPath, Pin
from models.vista import VanishingPoint, VistaAsset
from services.storage_service import IMAGE_URL_PREFIX
from routes.auth import require_auth
from routes.screen_access import displayed_item, websocket_allowed
from services.auth_service import (
    SCREEN_COOKIE_NAME, SCREEN_KEY_MAX_AGE, create_screen_key, dice_slot, verify_screen_key,
)
from services.battlemap_screen import BattlemapScreen
from services.doc_collection import DocNotFound
from services.doc_registry import hub
from services.socket_group import SocketGroup

logger = get_logger(__name__)
router = APIRouter(tags=["screen"])

# Screens don't log in (they pair with a screen key instead), so cap how many
# sockets this holds open. A table runs a handful of screens (TV,
# projector, OBS, a few phones); 50 leaves lots of room for that while
# stopping anyone from opening sockets until the process runs out of memory.
MAX_SCREEN_CONNECTIONS = 50

# A roll's label ("Bugboar · Gore") is drawn big on the screen: keep it short.
MAX_DICE_LABEL_LENGTH = 80


async def reject(websocket: WebSocket, code: int) -> None:
    """Accept, then close with `code`. Closing before accept makes uvicorn
    fail the handshake with a plain HTTP 403, which browsers only report as
    1006 — the client would never learn *why* it was turned away."""
    await websocket.accept()
    await websocket.close(code=code)


# Messages that patch the chart/vista/constellation already on screen with the GM's unsaved
# edits. They're kept apart from current_state (see ConnectionManager).
LIVE_UPDATE_TYPES = {"update_chart", "update_vista", "update_constellation", "update_battlemap"}

# Messages shown for a moment over whatever is on screen, which change nothing
# about it: a dice roll, a ping or the pointer on the battlemap showing.
TRANSIENT_TYPES = {"dice_roll", "battlemap_signal"}


class ConnectionManager:
    def __init__(self):
        self.screens = SocketGroup("screen", MAX_SCREEN_CONNECTIONS)
        self.current_state: dict = None
        # The latest live edit of the chart/vista in current_state, replayed
        # after it to screens that connect mid-edit. Dropped as soon as
        # anything else is sent, since that replaces what's on screen.
        self.live_draft: dict = None
        # One message at a time: two sent at once would reach each screen in
        # either order, and a screen could end up showing something other
        # than current_state (which is also what decides what it may read).
        self._sending = asyncio.Lock()

    @property
    def active_connections(self) -> List[WebSocket]:
        return self.screens.sockets

    async def connect(self, websocket: WebSocket) -> bool:
        if len(self.screens) >= self.screens.limit:
            logger.warning(f"Rejected screen connection: limit of {self.screens.limit} reached")
            # 1013 "Try Again Later": ScreenView's onclose already retries.
            await reject(websocket, 1013)
            return False
        await websocket.accept()
        async with self._sending:
            if not self.screens.add(websocket):
                await websocket.close(code=1013)
                return False
            logger.info(f"New screen connection. Total: {len(self.screens)}")
            # What is on screen now, and the GM's unsaved edits of it.
            for message in (self.current_state, self.live_draft):
                if message and not await self.screens.send(websocket, message):
                    return False
        return True

    def disconnect(self, websocket: WebSocket):
        if websocket in self.screens.sockets:
            self.screens.remove(websocket)
            logger.info(f"Screen disconnected. Total: {len(self.screens)}")

    async def broadcast(self, *messages: dict):
        """Sends each of `messages` to every screen, in order, with nothing
        sent in between."""
        async with self._sending:
            for message in messages:
                await self._broadcast(message)

    async def _broadcast(self, message: dict):
        # Dice rolls and pings (TRANSIENT_TYPES) are a transient overlay on
        # top of whatever is showing, not what's showing: keeping them out of
        # current_state means a screen that reconnects still gets the
        # chart/vista/image, and that
        # content stays readable to paired screens (routes/screen_access.py).
        #
        # Live edits are the same kind of overlay: current_state stays the
        # display_chart/display_vista pointer (screen_access reads it to know
        # what a paired screen may fetch) and the draft rides beside it.
        kind = message.get("type")
        if kind in LIVE_UPDATE_TYPES:
            self.live_draft = message
        elif kind not in TRANSIENT_TYPES:
            self.current_state = message
            self.live_draft = None
        # DEBUG, not INFO: every payload (media URLs, dice rolls) would
        # otherwise land in the logs for the whole session.
        logger.debug(f"Broadcasting to {len(self.screens)} screens: {message}")
        # To every screen at once, each with a time limit: a TV switched off
        # at the wall used to hold up every send, and the GM's request, until
        # its connection timed out (see SocketGroup).
        await self.screens.broadcast(message)

manager = ConnectionManager()

# What the screens show of a battlemap follows it as it changes: the hub tells
# this about every change to any live document.
battlemap_screen = BattlemapScreen(hub, manager)
hub.add_listener(battlemap_screen.on_event)

@router.websocket("/ws/screen")
async def websocket_endpoint(websocket: WebSocket):
    if not websocket_allowed(websocket):
        # 1008 "Policy Violation": ScreenView shows "pair this screen".
        await reject(websocket, 1008)
        return
    if not await manager.connect(websocket):
        return
    try:
        while True:
            # Keep connection alive - wait for message or disconnect
            # We use receive_text() to block until something happens
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        manager.disconnect(websocket)

class ScreenPairRequest(BaseModel):
    key: str


@router.post("/api/screen/link")
async def create_screen_link(user: dict = Depends(require_auth)):
    """A key for the GM to open as /screen#key=... on a TV/projector/OBS,
    which then pairs that device (see pair_screen) without it signing in."""
    return {"key": create_screen_key(user["email"])}


@router.post("/api/screen/pair")
async def pair_screen(body: ScreenPairRequest):
    """Swaps a screen key from the link for an httponly cookie, so it's not
    left in the address bar and reaches <img> and WebSocket requests too."""
    if not verify_screen_key(body.key):
        raise HTTPException(status_code=401, detail="Invalid or expired screen link")
    response = Response(status_code=204)
    response.set_cookie(
        SCREEN_COOKIE_NAME, body.key, max_age=SCREEN_KEY_MAX_AGE,
        httponly=True, secure=settings.SESSION_COOKIE_SECURE, samesite="lax",
    )
    return response


@router.post("/api/screen/display")
async def display_media(data: Dict[str, str], user: dict = Depends(require_auth)):
    """
    Broadcasts media to all connected screens.
    Expected data: {"url": "...", "title": "..."}
    """
    await manager.broadcast({
        "type": "display_media",
        "url": data.get("url"),
        "title": data.get("title", "")
    })
    return {"status": "success"}

# What the dice roller can throw (frontend utils/diceNotation.js): a screen
# replays every die of a roll, so a payload with more, or of a shape no die
# has, would freeze or break it.
SUPPORTED_DICE_SIDES = (2, 4, 6, 8, 10, 12, 20, 100)
MAX_DICE = 50
MAX_FLAT_MODIFIER = 10_000


class DiceGroup(BaseModel):
    """One NdM of a roll, as the roller reports it: each die's value, and which
    were dropped (kept highest/lowest)."""
    model_config = ConfigDict(extra="ignore")

    sides: Literal[SUPPORTED_DICE_SIDES]
    sign: Literal[1, -1] = 1
    rolls: List[int] = Field(max_length=MAX_DICE)
    kind: Optional[str] = Field(None, max_length=20)
    dropped: Optional[List[int]] = Field(None, max_length=MAX_DICE)

    @model_validator(mode="after")
    def _rolls_fit_the_die(self):
        if any(not 1 <= value <= self.sides for value in self.rolls):
            raise ValueError(f"a d{self.sides} can't roll that")
        return self


class DiceRollRequest(BaseModel):
    formula: str = Field("", max_length=200)
    # What the roll is for ("Bugboar · Gore"); cut, not refused, when long.
    label: Optional[str] = None
    groups: List[DiceGroup] = Field(default_factory=list, max_length=MAX_DICE)
    flatModifier: int = Field(0, ge=-MAX_FLAT_MODIFIER, le=MAX_FLAT_MODIFIER)
    total: int = Field(0, ge=-1_000_000, le=1_000_000)

    @model_validator(mode="after")
    def _at_most_max_dice(self):
        # A d100 is thrown as two dice (tens and units).
        if sum(len(g.rolls) * (2 if g.sides == 100 else 1) for g in self.groups) > MAX_DICE:
            raise ValueError(f"at most {MAX_DICE} dice at once")
        return self


@router.post("/api/screen/dice")
async def display_dice(body: DiceRollRequest, user: dict = Depends(require_auth)):
    """
    Broadcasts a dice roll result to all connected screens: the formula, each
    group's dice, the flat modifier and the total, plus an optional label
    saying what the roll is for ("Bugboar · Gore").
    The roller's name and dice colour come from the session, not the payload,
    so one player can't have their roll shown as another's. The screen shows
    the roller when there's no label (a roll from the dice panel or a note).
    """
    await manager.broadcast({
        "type": "dice_roll",
        "formula": body.formula,
        "label": (body.label or "")[:MAX_DICE_LABEL_LENGTH],
        "roller": user["name"][:MAX_DICE_LABEL_LENGTH],
        "groups": [group.model_dump(exclude_none=True) for group in body.groups],
        "flatModifier": body.flatModifier,
        "total": body.total,
        "diceSlot": dice_slot(user["email"])
    })
    return {"status": "success"}

@router.post("/api/screen/clear")
async def clear_screen(user: dict = Depends(require_auth)):
    """Clears all connected screens."""
    await manager.broadcast({
        "type": "clear_screen"
    })
    return {"status": "success"}

@router.post("/api/screen/chart")
async def display_chart(data: Dict[str, str], user: dict = Depends(require_auth)):
    """
    Tells all connected screens which chart to show. Screens fetch the chart
    themselves from GET /api/charts/{id} — which a paired screen may read only
    while it is the chart on screen (routes/screen_access.py) — this only
    broadcasts the pointer, same as display_media only broadcasting a URL.
    Expected data: {"chart_id": "..."}
    """
    await manager.broadcast({
        "type": "display_chart",
        "chart_id": data.get("chart_id")
    })
    return {"status": "success"}

@router.post("/api/screen/vista")
async def display_vista(data: Dict[str, str], user: dict = Depends(require_auth)):
    """
    Tells all connected screens which vista to show. Screens fetch the vista
    themselves from GET /api/vistas/{id} — which a paired screen may read only
    while it is the vista on screen (routes/screen_access.py) — this only
    broadcasts the pointer, same as display_chart only broadcasting an id.
    Expected data: {"vista_id": "..."}
    """
    await manager.broadcast({
        "type": "display_vista",
        "vista_id": data.get("vista_id")
    })
    return {"status": "success"}


class VistaLiveRequest(BaseModel):
    vista_id: str
    background_url: Optional[str] = None
    vanishing_point: VanishingPoint = VanishingPoint()
    background_offset_y: float = 50.0
    assets: List[VistaAsset] = []


class ChartLiveRequest(BaseModel):
    chart_id: str
    image_url: Optional[str] = None
    pins: List[Pin] = []
    paths: List[ChartPath] = []
    annotations: List[Annotation] = []


# A vault has hundreds of notes; this only stops a runaway payload.
MAX_CONSTELLATION_NODES = 5000


class ConstellationView(BaseModel):
    """The GM's pan/zoom (a d3 zoom transform) and the size of the canvas it
    was made on, so a screen of another size can show the same region."""
    x: float
    y: float
    k: float = Field(gt=0, le=100)
    width: float = Field(gt=0)
    height: float = Field(gt=0)


class ConstellationRequest(BaseModel):
    """Everything a screen needs to draw the constellation exactly as the GM
    has it: the force layout runs on the GM's side only, so node positions
    travel with it instead of each screen computing a different one."""
    view: ConstellationView
    positions: Dict[str, Tuple[float, float]] = Field(max_length=MAX_CONSTELLATION_NODES)
    highlighted_type: Optional[str] = Field(None, max_length=200)
    hover_id: Optional[str] = Field(None, max_length=1000)


def _require_library_urls(*urls: Optional[str]) -> None:
    """Same rule as saving: a draft may only draw images from the
    Observatory, since paired screens are allowed to read exactly those."""
    if any(url and not url.startswith(IMAGE_URL_PREFIX) for url in urls):
        raise HTTPException(status_code=400, detail="Images must be images from the Observatory")


@router.post("/api/screen/vista/live")
async def update_vista_live(body: VistaLiveRequest, user: dict = Depends(require_auth)):
    """
    Mirrors the GM's unsaved edits of the vista on screen, so the table sees
    them as they're made. Ignored unless this vista is the one being shown —
    editing a vista never puts it on screen by itself.
    """
    if displayed_item("vista") != body.vista_id.strip("/"):
        return {"status": "ignored"}
    _require_library_urls(body.background_url, *(a.image_url for a in body.assets))
    await manager.broadcast({"type": "update_vista", **body.model_dump()})
    return {"status": "success"}


@router.post("/api/screen/chart/live")
async def update_chart_live(body: ChartLiveRequest, user: dict = Depends(require_auth)):
    """Chart counterpart of update_vista_live."""
    if displayed_item("chart") != body.chart_id.strip("/"):
        return {"status": "ignored"}
    _require_library_urls(body.image_url, *(p.icon_url for p in body.pins))
    await manager.broadcast({"type": "update_chart", **body.model_dump()})
    return {"status": "success"}


class BattlemapShowRequest(BaseModel):
    battlemap_id: str


@router.post("/api/screen/battlemap")
async def display_battlemap(body: BattlemapShowRequest, user: dict = Depends(require_auth)):
    """
    Shows a battlemap on all screens, and keeps it current as it changes (see
    services/battlemap_screen.py). Screens are sent a projection of the map,
    not the map: hidden tokens never reach them, and they fetch nothing but the
    images it draws, which they may read for as long as it is on screen.
    """
    try:
        await battlemap_screen.show(body.battlemap_id.strip("/"))
    except DocNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"status": "success"}


class MapView(BaseModel):
    """The part of a battlemap framed on the screens, in its image's pixels."""
    x: float = Field(ge=-1e6, le=1e6)
    y: float = Field(ge=-1e6, le=1e6)
    width: float = Field(gt=0, le=1e6)
    height: float = Field(gt=0, le=1e6)


class BattlemapViewRequest(BaseModel):
    battlemap_id: str
    # None: the whole map.
    view: Optional[MapView] = None


@router.post("/api/screen/battlemap/view")
async def frame_battlemap(body: BattlemapViewRequest, user: dict = Depends(require_auth)):
    """
    Frames the part of the battlemap the GM is looking at on the screens, so
    they zoom and pan with the GM's view while the GM is live with it.
    Ignored unless this battlemap is the one being shown.
    """
    view = body.view.model_dump() if body.view else None
    if not await battlemap_screen.set_view(body.battlemap_id.strip("/"), view):
        return {"status": "ignored"}
    return {"status": "success"}


@router.post("/api/screen/constellation")
async def display_constellation(body: ConstellationRequest, user: dict = Depends(require_auth)):
    """
    Shows the constellation (the note graph) on all screens, frozen as the GM
    has it right now. Screens fetch the graph themselves from the public
    GET /api/graph/all; this carries the layout and view on top of it. Sent
    as the screen's content, so a screen that connects later gets it too.
    """
    await manager.broadcast({"type": "display_constellation", **body.model_dump()})
    return {"status": "success"}


@router.post("/api/screen/constellation/live")
async def update_constellation_live(body: ConstellationRequest, user: dict = Depends(require_auth)):
    """
    Mirrors the GM's zoom, pan, dragged nodes and highlights on the
    constellation on screen as they happen. Ignored unless the constellation
    is what's being shown.
    """
    state = manager.current_state or {}
    if state.get("type") != "display_constellation":
        return {"status": "ignored"}
    await manager.broadcast({"type": "update_constellation", **body.model_dump()})
    return {"status": "success"}
