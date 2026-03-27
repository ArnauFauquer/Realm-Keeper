import os
import logging
from pathlib import Path
from typing import List

class Settings:
    VAULT_PATH: Path = Path(os.getenv("VAULT_PATH", "./vault"))
    NOTE_TAG_IGNORE: str = os.getenv("NOTE_TAG_IGNORE", "private")
    REPO_URL: str = os.getenv("REPO_URL", "")

    CORS_ALLOWED_ORIGINS: List[str] = [
        origin.strip()
        for origin in os.getenv(
            "CORS_ALLOWED_ORIGINS", "http://localhost:5173"
        ).split(",")
    ]
    API_HOST: str = os.getenv("API_HOST", "0.0.0.0")
    API_PORT: int = int(os.getenv("API_PORT", "8000"))

    LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO")
    LOG_DIR: Path = Path(os.getenv("LOG_DIR", "/app/logs"))

    def __init__(self):
        self._validate_paths()

    def _validate_paths(self) -> None:
        self.VAULT_PATH.mkdir(parents=True, exist_ok=True)
        self.LOG_DIR.mkdir(parents=True, exist_ok=True)

settings = Settings()
