from routes.doc_router import make_doc_router
from services.doc_registry import BATTLEMAP, battlemap_collection, hub

router = make_doc_router(BATTLEMAP, battlemap_collection, hub)
