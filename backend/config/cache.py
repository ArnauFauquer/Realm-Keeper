from starlette.datastructures import MutableHeaders
import logging

logger = logging.getLogger(__name__)

class CacheControlMiddleware:
    """Plain ASGI middleware — deliberately NOT BaseHTTPMiddleware.

    BaseHTTPMiddleware buffers/re-streams the whole response through an
    in-memory channel, which raises anyio.WouldBlock -> EndOfStream (and
    takes the request down with an unhandled 500) if that stream gets
    interrupted — e.g. a client disconnecting mid-download of a streamed
    chart/audio asset. Plain ASGI middleware only touches the
    "http.response.start" message and passes everything else through
    untouched, so there's no stream to break.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path = scope["path"]
        method = scope["method"]
        cache_control = self._get_cache_control(path, method)

        async def send_wrapper(message):
            if message["type"] == "http.response.start" and cache_control:
                headers = MutableHeaders(raw=message["headers"])
                if "cache-control" not in headers:
                    # An explicit max-age makes even an error cacheable: a 401
                    # for an asset (not signed in, or no longer on screen)
                    # must not stick in the browser for a year.
                    value = cache_control if message["status"] < 400 else "no-store"
                    headers["cache-control"] = value
                    logger.debug(f"[Cache] {method} {path} → {value}")
            await send(message)

        await self.app(scope, receive, send_wrapper)

    @staticmethod
    def _get_cache_control(path: str, method: str) -> str:
        if method in ["POST", "PUT", "DELETE", "PATCH"]:
            return "no-cache, no-store, must-revalidate"
            
        if method == "GET":
            if path.startswith("/assets/"):
                return "public, max-age=31536000, immutable"
            if path.startswith("/api/note-raw/"):
                # Login-only editor source (can include hidden notes): keep it
                # out of the browser and service-worker caches entirely.
                return "private, no-store"
            if path.startswith("/api/notes"):
                return "public, max-age=300"
            if path.startswith("/api/tags"):
                return "public, max-age=600"
            if path.startswith("/api/graph"):
                return "public, max-age=600"
            if path.startswith("/api/player/"):
                # Player state (albums/tracks) is mutated by the user (upload,
                # delete, create/delete album) and must never be served stale
                # from the browser's HTTP cache after such a change.
                return "no-store, must-revalidate"
            if path.startswith("/api/auth/"):
                # Login state must never be cached (stale /me would show a
                # logged-out user as logged in, or vice versa).
                return "no-store, must-revalidate"
            if path.startswith("/api/asset-library/assets/"):
                # The binary image itself, keyed by its own filename — safe to
                # cache hard like /assets/, but only in the viewer's own
                # browser: it's behind login (or a paired screen), so shared
                # caches must not keep it, and the service worker skips it.
                return "private, max-age=31536000, immutable"
            if (
                path.startswith("/api/vistas")
                or path.startswith("/api/charts")
                or path.startswith("/api/asset-library")
            ):
                # A GM repositions/saves and immediately hits "Send to
                # screen" — the screen's fetch of this same vista/chart must
                # never be answered from a 60s-old cache, or the live
                # display can show a stale character position while the GM
                # is mid-session.
                return "no-store, must-revalidate"
            if path.startswith("/api/"):
                return "public, max-age=60"
        
        return None
