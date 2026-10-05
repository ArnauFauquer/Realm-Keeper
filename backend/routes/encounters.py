from routes.doc_follow import ON_MOVED
from routes.doc_router import make_doc_router
from services.doc_registry import ENCOUNTER, encounter_collection, hub

# Moving one points the maps that use it at its new id.
router = make_doc_router(ENCOUNTER, encounter_collection, hub, on_moved=ON_MOVED["encounter"])
