from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from typing import List, Dict
import json
from config.logging import get_logger

logger = get_logger(__name__)
router = APIRouter(tags=["screen"])

class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []
        self.current_state: dict = None

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info(f"New screen connection. Total: {len(self.active_connections)}")
        
        # If there's a current state, send it immediately to the new connection
        if self.current_state:
            try:
                await websocket.send_json(self.current_state)
                logger.info(f"Sent current state to new connection: {self.current_state}")
            except Exception as e:
                logger.error(f"Error sending initial state: {e}")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            logger.info(f"Screen disconnected. Total: {len(self.active_connections)}")

    async def broadcast(self, message: dict):
        self.current_state = message
        logger.info(f"Broadcasting to {len(self.active_connections)} screens: {message}")
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception as e:
                logger.error(f"Error sending message to connection: {e}")

manager = ConnectionManager()

@router.websocket("/ws/screen")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
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

@router.post("/api/screen/display")
async def display_media(data: Dict[str, str]):
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
async def display_dice(data: dict):
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
async def clear_screen():
    """Clears all connected screens."""
    await manager.broadcast({
        "type": "clear_screen"
    })
    return {"status": "success"}
