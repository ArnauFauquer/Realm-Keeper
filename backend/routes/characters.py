from routes.doc_router import make_doc_router
from services.doc_registry import CHARACTERS, characters_collection, hub

router = make_doc_router(CHARACTERS, characters_collection, hub)
