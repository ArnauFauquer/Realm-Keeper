from routes.doc_follow import following
from routes.doc_router import make_doc_router
from services.doc_registry import ADVERSARY, adversary_collection, hub
from services.sheet_refs import follow_moved_sheets

# Moving one points the notes, encounters and maps that use it at its new id.
router = make_doc_router(
    ADVERSARY, adversary_collection, hub, on_moved=following("adversary", follow_moved_sheets("adversary")),
)
