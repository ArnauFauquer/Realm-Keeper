"""
Cache Control Middleware - Agrega headers HTTP Cache-Control automáticamente
según el tipo de endpoint y su método HTTP
"""

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response
import logging

logger = logging.getLogger(__name__)


class CacheControlMiddleware(BaseHTTPMiddleware):
    """
    Middleware que agrega headers Cache-Control automáticamente.
    
    Estrategia:
    - GET /api/notes/* → Cache-Control: max-age=300 (5 min)
    - GET /api/tags → Cache-Control: max-age=600 (10 min)
    - GET /api/graph/* → Cache-Control: max-age=600 (10 min)
    - POST/PUT/DELETE → Cache-Control: no-cache
    - Assets → Cache-Control: max-age=31536000 (1 año)
    """
    
    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)
        
        # No modificar si ya tiene Cache-Control header
        if "cache-control" in response.headers:
            return response
        
        # Obtener path y método
        path = request.url.path
        method = request.method
        
        # Determinar cache strategy basado en path y método
        cache_control = self._get_cache_control(path, method)
        
        if cache_control:
            response.headers["Cache-Control"] = cache_control
            logger.debug(f"[Cache] {method} {path} → {cache_control}")
        
        return response
    
    @staticmethod
    def _get_cache_control(path: str, method: str) -> str:
        """
        Determinar Cache-Control header basado en path y método.
        
        Returns:
            String con el valor de Cache-Control o None
        """
        
        # PUT, POST, DELETE → no cachear en navegador
        if method in ["POST", "PUT", "DELETE", "PATCH"]:
            return "no-cache, no-store, must-revalidate"
        
        # GET requests - según el endpoint
        if method == "GET":
            # Static assets - cachear por 1 año
            if path.startswith("/assets/"):
                return "public, max-age=31536000, immutable"
            
            # Notes - cachear 5 minutos
            if path.startswith("/api/notes"):
                return "public, max-age=300"
            
            # Tags - cachear 10 minutos
            if path.startswith("/api/tags"):
                return "public, max-age=600"
            
            # Graph - cachear 10 minutos
            if path.startswith("/api/graph"):
                return "public, max-age=600"
            
            # Default para otros GETs - cachear 1 minuto
            if path.startswith("/api/"):
                return "public, max-age=60"
        
        # Sin cache para otros requests
        return None
