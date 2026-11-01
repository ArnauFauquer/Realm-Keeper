from routes.doc_follow import ON_MOVED
from routes.doc_router import make_doc_router
from services.doc_registry import CHARACTER, characters_collection, hub

# Moving one points the notes, encounters and maps that use it at its new id.
router = make_doc_router(CHARACTER, characters_collection, hub, on_moved=ON_MOVED["character"])
