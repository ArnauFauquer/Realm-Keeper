import os
import logging
import secrets
from pathlib import Path
from typing import List

class Settings:
    VAULT_PATH: Path = Path(os.getenv("VAULT_PATH", "./vault"))
    NOTE_TAG_IGNORE: str = os.getenv("NOTE_TAG_IGNORE", "private")
    REPO_URL: str = os.getenv("REPO_URL", "")
    GIT_SYNC_INTERVAL: int = int(os.getenv("GIT_SYNC_INTERVAL", "300"))

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

    S3_ENDPOINT_URL: str = os.getenv("S3_ENDPOINT_URL", "")
    S3_ACCESS_KEY: str = os.getenv("S3_ACCESS_KEY", "")
    S3_SECRET_KEY: str = os.getenv("S3_SECRET_KEY", "")
    S3_BUCKET_NAME: str = os.getenv("S3_BUCKET_NAME", "realm-keeper-audio")
    S3_REGION: str = os.getenv("S3_REGION", "us-east-1")

    GOOGLE_CLIENT_ID: str = os.getenv("GOOGLE_CLIENT_ID", "")
    GOOGLE_CLIENT_SECRET: str = os.getenv("GOOGLE_CLIENT_SECRET", "")
    # Set to false to run without Google OAuth — e.g. self-hosting solo with
    # no need to gate access, or local dev without OAuth credentials set up.
    # require_auth then lets every request through as a fixed local user.
    ENABLE_AUTH: bool = os.getenv("ENABLE_AUTH", "true").lower() == "true"
    # Falls back to a random key generated at process startup if unset, so
    # auth still works locally without configuration — but every restart
    # invalidates existing sessions until a real value is set (required in
    # production, where you want sessions to survive a redeploy).
    SESSION_SECRET_KEY: str = os.getenv("SESSION_SECRET_KEY") or secrets.token_urlsafe(32)
    ALLOWED_EMAILS: List[str] = [
        e.strip().lower()
        for e in os.getenv("ALLOWED_EMAILS", "").split(",")
        if e.strip()
    ]
    FRONTEND_URL: str = os.getenv("FRONTEND_URL", "http://localhost:5173")
    SESSION_COOKIE_SECURE: bool = os.getenv("SESSION_COOKIE_SECURE", "false").lower() == "true"

    def __init__(self):
        self._validate_paths()

    def _validate_paths(self) -> None:
        self.VAULT_PATH.mkdir(parents=True, exist_ok=True)
        self.LOG_DIR.mkdir(parents=True, exist_ok=True)

settings = Settings()
