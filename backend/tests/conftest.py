"""The app reads its settings from the environment once, when it is first
imported: set them here, before any test module (or the app) is imported, so
every module sees the same vault, the same login rules and a document store
that lives in a throwaway folder."""
import os
import sys
import tempfile
from pathlib import Path

TEST_ROOT = Path(tempfile.mkdtemp())
os.environ.update({
    "VAULT_PATH": str(TEST_ROOT / "vault"),
    "LOG_DIR": str(TEST_ROOT / "logs"),
    "DOCS_LOCAL_PATH": str(TEST_ROOT / "docs"),
    "ENABLE_AUTH": "true",
    "ALLOWED_EMAILS": "gm@example.com",
    "SESSION_SECRET_KEY": "test-secret",
    "NOTE_TAG_IGNORE": "draft",
    "FRONTEND_URL": "https://app.example.com",
    "CORS_ALLOWED_ORIGINS": "https://app.example.com",
    "REPO_URL": "",
    "S3_ENDPOINT_URL": "",
})
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
