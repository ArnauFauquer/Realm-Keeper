from fastapi import Depends

from models.battlemap import MapSignal
from routes.auth import require_auth
from routes.doc_router import make_doc_router
from routes.errors import guarded
from routes.screen import battlemap_screen
from services.auth_service import dice_slot
from services.doc_registry import BATTLEMAP, battlemap_collection, hub

router = make_doc_router(BATTLEMAP, battlemap_collection, hub)

# Who pings: shown beside the ping, cut like a roll's name.
MAX_SIGNAL_NAME_LENGTH = 80


@router.post("/{doc_id:path}/signal")
@guarded
async def send_signal(doc_id: str, body: MapSignal, user: dict = Depends(require_auth)):
    """
    Shows a ping, the laser pointer or a roll over a token to everyone who has
    the map open, and on the screens if it is the map they show. Nothing is
    kept: the map doesn't change, and a screen that connects later sees none
    of it. Who sent it, and their colour, come from the session.
    """
    battlemap = await hub.snapshot("battlemap", doc_id)
    signal = {
        **body.model_dump(exclude_none=True),
        "by": user["name"][:MAX_SIGNAL_NAME_LENGTH],
        "slot": dice_slot(user["email"]),
    }
    await hub.announce({"type": "signal", "battlemap": battlemap["id"], **signal})
    await battlemap_screen.relay_signal(battlemap, signal)
    return {"status": "success"}
