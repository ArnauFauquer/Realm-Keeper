from urllib.parse import urlsplit

from starlette.datastructures import Headers
from starlette.responses import JSONResponse

import logging

logger = logging.getLogger(__name__)

UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


def _origin_of(url: str) -> str:
    parts = urlsplit(url.strip())
    return f"{parts.scheme}://{parts.netloc}".lower() if parts.scheme and parts.netloc else ""


class OriginCheckMiddleware:
    """Rejects state-changing requests a browser sent from a foreign origin.

    The session cookie is SameSite=Lax, which already keeps it off cross-site
    POSTs — but "site" spans every subdomain of the registrable domain, and
    with ENABLE_AUTH=false there's no cookie to withhold at all, so any page
    could otherwise fire a multipart upload or form POST (both "simple"
    requests that CORS never preflights) at the API. Browsers always send
    Origin on those, so checking it closes the gap. Requests without an
    Origin header (curl, server-to-server) aren't from a browser page and
    pass through.

    Plain ASGI rather than BaseHTTPMiddleware, for the same streaming reason
    as CacheControlMiddleware.
    """

    def __init__(self, app, allowed_origins: list[str]):
        self.app = app
        self.allowed_origins = {o for o in (_origin_of(u) for u in allowed_origins) if o}

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] not in UNSAFE_METHODS:
            await self.app(scope, receive, send)
            return

        headers = Headers(scope=scope)
        origin = headers.get("origin")
        if origin is None or self._is_allowed(origin, headers.get("host", "")):
            await self.app(scope, receive, send)
            return

        logger.warning(f"Blocked cross-origin {scope['method']} {scope['path']} from {origin!r}")
        response = JSONResponse({"detail": "Cross-origin request blocked"}, status_code=403)
        await response(scope, receive, send)

    def _is_allowed(self, origin: str, host: str) -> bool:
        normalized = _origin_of(origin)
        if not normalized:
            # "null" (sandboxed iframes, file://) and anything unparsable.
            return False
        if normalized in self.allowed_origins:
            return True
        # Same-origin through a reverse proxy that forwards the Host header
        # (nginx.conf / the ingress) — e.g. the app opened via a LAN IP.
        return bool(host) and urlsplit(normalized).netloc == host.lower()
