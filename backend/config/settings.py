import os
import logging
from pathlib import Path
from typing import List, Optional

class Settings:
    VAULT_PATH: Path = Path(os.getenv("VAULT_PATH", "/app/vault"))
    REPO_URL: Optional[str] = os.getenv("REPO_URL", None)
    VAULT_SYNC_INTERVAL: int = int(os.getenv("VAULT_SYNC_INTERVAL", "180"))
    NOTE_TAG_IGNORE: str = os.getenv("NOTE_TAG_IGNORE", "draft")

    CORS_ALLOWED_ORIGINS: List[str] = [
        origin.strip()
        for origin in os.getenv(
            "CORS_ALLOWED_ORIGINS", "http://localhost:5173"
        ).split(",")
    ]
    API_HOST: str = os.getenv("API_HOST", "0.0.0.0")
    API_PORT: int = int(os.getenv("API_PORT", "8000"))

    MAX_NOTES_PER_REQUEST: int = 500
    MARKDOWN_CACHE_TTL: int = 300

    LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO")
    LOG_DIR: Path = Path(os.getenv("LOG_DIR", "/app/logs"))

    RATE_LIMIT_ENABLED: bool = os.getenv("RATE_LIMIT_ENABLED", "true").lower() == "true"
    RATE_LIMIT_REQUESTS: int = int(os.getenv("RATE_LIMIT_REQUESTS", "100"))
    RATE_LIMIT_WINDOW: int = int(os.getenv("RATE_LIMIT_WINDOW", "60"))

    def __init__(self):
        self._validate_paths()
        self._validate_configuration()

    def _validate_paths(self) -> None:
        self.VAULT_PATH.mkdir(parents=True, exist_ok=True)
        self.LOG_DIR.mkdir(parents=True, exist_ok=True)

    def _validate_configuration(self) -> None:
        if self.VAULT_SYNC_INTERVAL > 0 and not self.REPO_URL:
            logging.warning(
                "WARNING: VAULT_SYNC_INTERVAL set but no REPO_URL configured. "
                "Vault sync will be disabled."
            )

    def get_log_file(self, name: str) -> Path:
        return self.LOG_DIR / f"{name}.log"

settings = Settings()
