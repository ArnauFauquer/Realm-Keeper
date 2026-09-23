from fastapi import APIRouter, Depends, HTTPException, Response, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from typing import List, Dict
import json
from config.logging import get_logger
from config.settings import settings
from routes.auth import require_auth
from routes.screen_access import websocket_allowed
from services.auth_service import SCREEN_COOKIE_NAME, SCREEN_KEY_MAX_AGE, create_screen_key, verify_screen_key

logger = get_logger(__name__)
router = APIRouter(tags=["screen"])

# Screens don't log in (they pair with a screen key instead), so cap how many
# sockets this holds open. A table runs a handful of screens (TV,
# projector, OBS, a few phones); 50 leaves lots of room for that while
# stopping anyone from opening sockets until the process runs out of memory.
MAX_SCREEN_CONNECTIONS = 50


async def reject(websocket: WebSocket, code: int) -> None:
    """Accept, then close with `code`. Closing before accept makes uvicorn
    fail the handshake with a plain HTTP 403, which browsers only report as
    1006 — the client would never learn *why* it was turned away."""
    await websocket.accept()
    await websocket.close(code=code)


class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []
        self.current_state: dict = None

    async def connect(self, websocket: WebSocket) -> bool:
        if len(self.active_connections) >= MAX_SCREEN_CONNECTIONS:
            logger.warning(f"Rejected screen connection: limit of {MAX_SCREEN_CONNECTIONS} reached")
            # 1013 "Try Again Later": ScreenView's onclose already retries.
            await reject(websocket, 1013)
            return False
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info(f"New screen connection. Total: {len(self.active_connections)}")
        
        # If there's a current state, send it immediately to the new connection
        if self.current_state:
            try:
                await websocket.send_json(self.current_state)
                logger.debug(f"Sent current state to new connection: {self.current_state}")
            except Exception as e:
                logger.error(f"Error sending initial state: {e}")
        return True

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            logger.info(f"Screen disconnected. Total: {len(self.active_connections)}")

    async def broadcast(self, message: dict):
        # Dice rolls are a transient overlay on top of whatever is showing,
        # not what's showing: keeping them out of current_state means a
        # screen that reconnects still gets the chart/vista/image, and that
        # content stays readable to paired screens (routes/screen_access.py).
        if message.get("type") != "dice_roll":
            self.current_state = message
        # DEBUG, not INFO: every payload (media URLs, dice rolls) would
        # otherwise land in the logs for the whole session.
        logger.debug(f"Broadcasting to {len(self.active_connections)} screens: {message}")
        for connection in list(self.active_connections):
            try:
                await connection.send_json(message)
            except Exception as e:
                # A socket that can't be written to is gone; drop it so dead
                # connections don't pile up against MAX_SCREEN_CONNECTIONS.
                logger.error(f"Error sending message to connection: {e}")
                self.disconnect(connection)

manager = ConnectionManager()

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

@router.post("/api/screen/dice")
async def display_dice(data: dict, user: dict = Depends(require_auth)):
    """
    Broadcasts a dice roll result to all connected screens.
    Expected data: {"formula": "...", "groups": [...], "flatModifier": 0, "total": 0}
    """
    await manager.broadcast({
        "type": "dice_roll",
        "formula": data.get("formula", ""),
        "groups": data.get("groups", []),
        "flatModifier": data.get("flatModifier", 0),
        "total": data.get("total", 0)
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
