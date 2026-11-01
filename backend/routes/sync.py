"""The socket live documents are announced on: every change to any of them,
as it is made. Clients only listen — they change documents through the HTTP
routes (routes/doc_router.py) — and each keeps the documents it has open up
to date with the events (see services/sync_hub.py)."""
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from config.logging import get_logger
from routes.auth import current_user
from routes.screen import reject
from services.doc_registry import hub

logger = get_logger(__name__)
router = APIRouter(tags=["sync"])


@router.websocket("/ws/sync")
async def sync_socket(websocket: WebSocket):
    if current_user(websocket) is None:
        # 1008 "Policy Violation": the client stops retrying and shows a sign-in.
        await reject(websocket, 1008)
        return
    await websocket.accept()
    if not hub.connect(websocket):
        # 1013 "Try Again Later": the client retries.
        await websocket.close(code=1013)
        return
    try:
        while True:
            # Nothing is expected from a client; this only notices it leaving.
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error(f"Sync socket error: {e}")
    finally:
        hub.disconnect(websocket)
