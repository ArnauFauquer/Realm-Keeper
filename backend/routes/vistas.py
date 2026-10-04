from routes.doc_follow import following
from routes.doc_router import make_doc_router
from routes.screen_access import require_viewer
from services.doc_registry import VISTA, hub, vista_collection

# Everything needs a login, except reading a vista: a paired screen may read the
# one that is on screen (routes/screen_access.py).
router = make_doc_router(
    VISTA, vista_collection, hub,
    viewer=lambda request, vista_id: require_viewer(request, vista_id=vista_id),
    on_moved=following("vista"),
)
