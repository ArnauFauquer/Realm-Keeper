from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response
import logging

logger = logging.getLogger(__name__)

class CacheControlMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)
        
        if "cache-control" in response.headers:
            return response
            
        path = request.url.path
        method = request.method
        
        cache_control = self._get_cache_control(path, method)
        
        if cache_control:
            response.headers["Cache-Control"] = cache_control
            logger.debug(f"[Cache] {method} {path} → {cache_control}")
            
        return response
        
    @staticmethod
    def _get_cache_control(path: str, method: str) -> str:
        if method in ["POST", "PUT", "DELETE", "PATCH"]:
            return "no-cache, no-store, must-revalidate"
            
        if method == "GET":
            if path.startswith("/assets/"):
                return "public, max-age=31536000, immutable"
            if path.startswith("/api/notes"):
                return "public, max-age=300"
            if path.startswith("/api/tags"):
                return "public, max-age=600"
            if path.startswith("/api/graph"):
                return "public, max-age=600"
            if path.startswith("/api/"):
                return "public, max-age=60"
        
        return None
