import os
import logging
import secrets
from pathlib import Path
from typing import List


def _flag(name: str, default: bool) -> bool:
    value = os.getenv(name, "").strip().lower()
    return default if not value else value in ("1", "true", "yes", "on")


class Settings:
    VAULT_PATH: Path = Path(os.getenv("VAULT_PATH", "./vault"))
    NOTE_TAG_IGNORE: str = os.getenv("NOTE_TAG_IGNORE", "private")
    # The note the app opens on (its id: path without ".md"). Empty: the first
    # of HOME_NOTE_CANDIDATES the vault has (services/markdown_service.py).
    HOME_NOTE: str = os.getenv("HOME_NOTE", "").strip().strip("/")
    REPO_URL: str = os.getenv("REPO_URL", "")
    # Whether the vault is a git repository the app pulls and pushes. On by
    # default when there is a REPO_URL to clone. Off, the vault is a plain
    # folder (say an Obsidian vault mounted as a volume): a note saved in the
    # app is only written to disk, and what changes there from outside is
    # picked up every VAULT_WATCH_INTERVAL seconds. On without a REPO_URL, the
    # vault must already be a clone, whose own remote is pulled and pushed.
    GIT_ENABLED: bool = _flag("GIT_ENABLED", bool(REPO_URL))
    GIT_SYNC_INTERVAL: int = int(os.getenv("GIT_SYNC_INTERVAL", "300"))
    VAULT_WATCH_INTERVAL: int = int(os.getenv("VAULT_WATCH_INTERVAL", "10"))

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
    # Where the documents, the images and the audio are kept: "s3" (any
    # S3-compatible bucket: MinIO, Ceph RGW, AWS...) or "local" (a folder,
    # STORAGE_LOCAL_PATH, the same tree as the bucket's). Defaults to S3 when
    # an endpoint is set, as before the choice existed.
    STORAGE_BACKEND: str = os.getenv("STORAGE_BACKEND", "s3" if S3_ENDPOINT_URL else "local").strip().lower()
    # DOCS_LOCAL_PATH is its earlier name, from when only documents went there.
    STORAGE_LOCAL_PATH: Path = Path(os.getenv("STORAGE_LOCAL_PATH") or os.getenv("DOCS_LOCAL_PATH") or "./data")

    # Sign-in. Any OpenID Connect provider (Microsoft Entra ID, Keycloak,
    # Authentik, Authelia, Auth0, Okta, Zitadel, GitLab, Pocket ID...) by its
    # issuer URL; GitHub, which speaks plain OAuth rather than OIDC; and Google
    # by its own two variables, as before. Every one configured gets a button.
    OIDC_ISSUER_URL: str = os.getenv("OIDC_ISSUER_URL", "").strip()
    OIDC_CLIENT_ID: str = os.getenv("OIDC_CLIENT_ID", "")
    OIDC_CLIENT_SECRET: str = os.getenv("OIDC_CLIENT_SECRET", "")
    OIDC_SCOPES: str = os.getenv("OIDC_SCOPES", "openid email profile")
    # The provider's name on the sign-in button ("Sign in with <name>").
    OIDC_NAME: str = os.getenv("OIDC_NAME", "").strip() or "SSO"
    # An email the provider hasn't verified is only a claim, never matched
    # against ALLOWED_EMAILS. Turn off only for a provider that never sends
    # `email_verified` and where only its admins can set an address (a
    # single-tenant Entra ID, your own Keycloak).
    OIDC_REQUIRE_VERIFIED_EMAIL: bool = _flag("OIDC_REQUIRE_VERIFIED_EMAIL", True)
    GITHUB_CLIENT_ID: str = os.getenv("GITHUB_CLIENT_ID", "")
    GITHUB_CLIENT_SECRET: str = os.getenv("GITHUB_CLIENT_SECRET", "")
    GOOGLE_CLIENT_ID: str = os.getenv("GOOGLE_CLIENT_ID", "")
    GOOGLE_CLIENT_SECRET: str = os.getenv("GOOGLE_CLIENT_SECRET", "")
    # Set to false to run without a login — e.g. self-hosting solo with no
    # need to gate access, or local dev without a provider set up.
    # require_auth then lets every request through as a fixed local user.
    ENABLE_AUTH: bool = _flag("ENABLE_AUTH", True)
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
    # Defaults to on whenever the app is served over HTTPS, so forgetting to
    # set it in a TLS deployment can't leave the session cookie sendable over
    # plain HTTP. Set it explicitly to override either way.
    SESSION_COOKIE_SECURE: bool = os.getenv(
        "SESSION_COOKIE_SECURE", str(FRONTEND_URL.lower().startswith("https://"))
    ).lower() == "true"

    def __init__(self):
        if self.STORAGE_BACKEND not in ("s3", "local"):
            raise ValueError(f"STORAGE_BACKEND must be 's3' or 'local', not {self.STORAGE_BACKEND!r}")
        self._validate_paths()

    def _validate_paths(self) -> None:
        self.VAULT_PATH.mkdir(parents=True, exist_ok=True)
        self.LOG_DIR.mkdir(parents=True, exist_ok=True)

settings = Settings()
