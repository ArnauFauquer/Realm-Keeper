from routes.doc_router import make_doc_router
from services.doc_registry import ENCOUNTER, encounter_collection, hub

router = make_doc_router(ENCOUNTER, encounter_collection, hub)
