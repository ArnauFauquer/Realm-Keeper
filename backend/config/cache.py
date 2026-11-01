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

    # The public reads of the vault: a browser (and the service worker, for
    # reading offline) may keep them, but asks again every time, so a note
    # just saved, created or pulled shows at once rather than minutes later.
    PUBLIC_NOTE_READS = ("/api/note/", "/api/notes", "/api/tags", "/api/graph", "/api/container-folders")

    @staticmethod
    def _get_cache_control(path: str, method: str) -> str:
        if method in ["POST", "PUT", "DELETE", "PATCH"]:
            return "no-cache, no-store, must-revalidate"

        if method == "GET":
            if path.startswith("/assets/"):
                return "public, max-age=31536000, immutable"
            if path.startswith("/api/observatory/images/"):
                # The binary image itself, found by a uid no other upload ever
                # gets — safe to cache hard like /assets/, but only in the
                # viewer's own browser: it's behind login (or a paired screen),
                # so shared caches must not keep it, and the service worker skips it.
                return "private, max-age=31536000, immutable"
            if path.startswith(CacheControlMiddleware.PUBLIC_NOTE_READS):
                return "public, no-cache"
            if path.startswith("/api/"):
                # Everything else is behind login (documents, the player, the
                # editor's raw notes, the sheets), changes as people play, or
                # is login state itself: never kept by a browser, a shared
                # cache or the service worker. A default rather than a list of
                # each kind's prefix, so a kind added later is safe too.
                return "no-store, must-revalidate"

        return None
