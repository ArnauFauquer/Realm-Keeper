from starlette.datastructures import MutableHeaders

# The API answers JSON, files and event streams, never a page: nothing it
# sends should be run, framed or embedded by another site. Swagger/ReDoc
# (served by FastAPI) load their scripts from a CDN, so they keep no CSP.
API_HEADERS = {
    "strict-transport-security": "max-age=31536000; includeSubDomains",
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-resource-policy": "same-origin",
    "cross-origin-embedder-policy": "require-corp",
}
API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
DOC_PATHS = ("/docs", "/redoc")


class SecurityHeadersMiddleware:
    """Plain ASGI middleware (see CacheControlMiddleware for why): only the
    response start is touched."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        is_doc = scope["path"].startswith(DOC_PATHS)

        async def send_wrapper(message):
            if message["type"] == "http.response.start":
                headers = MutableHeaders(raw=message["headers"])
                for name, value in API_HEADERS.items():
                    if name not in headers and not (is_doc and name.startswith("cross-origin-embedder")):
                        headers[name] = value
                if not is_doc and "content-security-policy" not in headers:
                    headers["content-security-policy"] = API_CSP
            await send(message)

        await self.app(scope, receive, send_wrapper)
