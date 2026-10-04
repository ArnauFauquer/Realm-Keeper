from routes.doc_router import make_doc_router
from routes.screen_access import require_viewer
from services.doc_registry import CHART, chart_collection, hub

# Everything needs a login, except reading a chart: a paired screen may read the
# one that is on screen (routes/screen_access.py).
router = make_doc_router(
    CHART, chart_collection, hub,
    viewer=lambda request, chart_id: require_viewer(request, chart_id=chart_id),
)
