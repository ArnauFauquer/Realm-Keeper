"""
Configuración centralizada del backend de Realm Keeper
Maneja todas las variables de entorno y configuración de la aplicación
"""

import os
import logging
from pathlib import Path
from typing import List, Optional


class Settings:
    """Configuración centralizada del backend"""

    # ============================================================
    # VAULT CONFIGURATION
    # ============================================================
    VAULT_PATH: Path = Path(os.getenv("VAULT_PATH", "/app/vault"))
    REPO_URL: Optional[str] = os.getenv("REPO_URL", None)
    VAULT_SYNC_INTERVAL: int = int(os.getenv("VAULT_SYNC_INTERVAL", "3600"))  # Default: 1 hour
    NOTE_TAG_IGNORE: str = os.getenv("NOTE_TAG_IGNORE", "draft")

    # ============================================================
    # API CONFIGURATION
    # ============================================================
    CORS_ALLOWED_ORIGINS: List[str] = [
        origin.strip()
        for origin in os.getenv(
            "CORS_ALLOWED_ORIGINS", "http://localhost:5173"
        ).split(",")
    ]
    API_HOST: str = os.getenv("API_HOST", "0.0.0.0")
    API_PORT: int = int(os.getenv("API_PORT", "8000"))

    # ============================================================
    # LIGHTRAG CONFIGURATION
    # ============================================================
    LIGHTRAG_WORKING_DIR: Path = Path(
        os.getenv("LIGHTRAG_WORKING_DIR", "/app/rag_storage")
    )
    OLLAMA_HOST: str = os.getenv("OLLAMA_HOST", "http://ollama:11434")
    LLM_MODEL: str = os.getenv("LLM_MODEL", "llama3.2")
    EMBEDDING_MODEL: str = os.getenv("EMBEDDING_MODEL", "nomic-embed-text")
    EMBEDDING_DIM: int = int(os.getenv("EMBEDDING_DIM", "768"))
    LLM_CONTEXT_SIZE: int = int(os.getenv("LLM_CONTEXT_SIZE", "32768"))

    # ============================================================
    # TIMEOUT CONFIGURATION (in seconds)
    # ============================================================
    LLM_TIMEOUT: int = int(os.getenv("LLM_TIMEOUT", "600"))  # 10 min
    EMBED_TIMEOUT: int = int(os.getenv("EMBED_TIMEOUT", "120"))  # 2 min
    QUERY_TIMEOUT: int = int(os.getenv("QUERY_TIMEOUT", "300"))  # 5 min

    # ============================================================
    # LIMITS & CONSTRAINTS
    # ============================================================
    MAX_STREAM_CHUNKS: int = 10000
    MAX_NOTES_PER_REQUEST: int = 500
    QUERY_MAX_RETRIES: int = 3
    MARKDOWN_CACHE_TTL: int = 300  # 5 minutes

    # ============================================================
    # LOGGING CONFIGURATION
    # ============================================================
    LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO")
    LOG_DIR: Path = Path(os.getenv("LOG_DIR", "/app/logs"))

    # ============================================================
    # RATE LIMITING
    # ============================================================
    RATE_LIMIT_ENABLED: bool = os.getenv("RATE_LIMIT_ENABLED", "true").lower() == "true"
    RATE_LIMIT_REQUESTS: int = int(os.getenv("RATE_LIMIT_REQUESTS", "100"))
    RATE_LIMIT_WINDOW: int = int(os.getenv("RATE_LIMIT_WINDOW", "60"))  # seconds

    def __init__(self):
        """Validación en startup"""
        self._validate_paths()
        self._validate_configuration()

    def _validate_paths(self) -> None:
        """Crear directorios necesarios si no existen"""
        self.VAULT_PATH.mkdir(parents=True, exist_ok=True)
        self.LIGHTRAG_WORKING_DIR.mkdir(parents=True, exist_ok=True)
        self.LOG_DIR.mkdir(parents=True, exist_ok=True)

    def _validate_configuration(self) -> None:
        """Validar configuración crítica"""
        if self.VAULT_SYNC_INTERVAL > 0 and not self.REPO_URL:
            # Use logging.warning para no crear dependencia circular
            logging.warning(
                "WARNING: VAULT_SYNC_INTERVAL set but no REPO_URL configured. "
                "Vault sync will be disabled."
            )

        if self.QUERY_TIMEOUT <= 0:
            raise ValueError("QUERY_TIMEOUT must be greater than 0")

        if self.MAX_STREAM_CHUNKS <= 0:
            raise ValueError("MAX_STREAM_CHUNKS must be greater than 0")

    def get_log_file(self, name: str) -> Path:
        """Obtener ruta de archivo de log"""
        return self.LOG_DIR / f"{name}.log"


# Instancia global singleton
settings = Settings()
