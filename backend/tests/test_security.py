"""Regression tests for access-control and injection fixes. Run from backend/:
    python -m pytest tests/test_security.py
"""
import os
import sys
import tempfile
from pathlib import Path

import pytest

_tmp = Path(tempfile.mkdtemp())
os.environ.update({
    "VAULT_PATH": str(_tmp / "vault"),
    "LOG_DIR": str(_tmp / "logs"),
    "ENABLE_AUTH": "true",
    "ALLOWED_EMAILS": "gm@example.com",
    "SESSION_SECRET_KEY": "test-secret",
    "NOTE_TAG_IGNORE": "draft",
    "FRONTEND_URL": "https://app.example.com",
    "CORS_ALLOWED_ORIGINS": "https://app.example.com",
    "REPO_URL": "",
})
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402

from config.settings import settings  # noqa: E402
from main import app  # noqa: E402
from services import storage_service  # noqa: E402
from services.auth_service import SESSION_COOKIE_NAME, create_session_token  # noqa: E402
from services.git_sync_utils import GitCommitError, redact_credentials  # noqa: E402


@pytest.fixture(scope="module")
def client():
    vault = settings.VAULT_PATH
    (vault / "public.md").write_text("# Public\n", encoding="utf-8")
    (vault / "secret.md").write_text("---\ntags: [draft]\n---\n# Secret plans\n", encoding="utf-8")
    with TestClient(app) as c:
        yield c


def test_hidden_note_not_readable_by_id(client):
    assert client.get("/api/note/public").status_code == 200
    assert client.get("/api/note/secret").status_code == 404


def test_raw_note_requires_login(client):
    assert client.get("/api/note-raw/public").status_code == 401


def test_note_path_rejects_hidden_segments(client):
    client.cookies.set(SESSION_COOKIE_NAME, create_session_token("gm@example.com"))
    try:
        r = client.put("/api/note/.git/hooks/x", json={"content": "x"})
        assert r.status_code == 400
    finally:
        client.cookies.clear()


def test_session_revoked_when_removed_from_allowlist(client):
    token = create_session_token("former-player@example.com")
    client.cookies.set(SESSION_COOKIE_NAME, token)
    try:
        assert client.get("/api/auth/me").status_code == 401
    finally:
        client.cookies.clear()


def test_public_asset_endpoint_cannot_read_other_prefixes(client):
    # Audio lives outside asset-library/ and is behind login on /api/player.
    r = client.get("/api/asset-library/assets/Combat/boss-theme.mp3")
    assert r.status_code == 400


def test_track_keys_cannot_reach_reserved_prefixes():
    with pytest.raises(storage_service.StorageError):
        storage_service.get_track_stream("asset-library/map.png")
    with pytest.raises(storage_service.StorageError):
        storage_service.delete_album("asset-library")


def test_served_content_type_ignores_uploaded_metadata():
    assert storage_service.content_type_for("asset-library/evil.png") == "image/png"
    assert storage_service.content_type_for("asset-library/evil.html") == "application/octet-stream"


def test_cross_origin_write_blocked(client):
    r = client.post("/api/screen/clear", headers={"Origin": "https://evil.example.org"})
    assert r.status_code == 403
    # Same-origin (and non-browser, no Origin) requests reach the route, which
    # then answers 401 for lack of a session.
    assert client.post("/api/screen/clear", headers={"Origin": "https://app.example.com"}).status_code == 401
    assert client.post("/api/screen/clear").status_code == 401


def test_vista_assets_must_come_from_library(client):
    client.cookies.set(SESSION_COOKIE_NAME, create_session_token("gm@example.com"))
    try:
        r = client.put("/api/vistas/whatever", json={
            "name": "x",
            "assets": [{"id": "a", "name": "a", "image_url": "https://evil.example.org/x.svg"}],
        })
        assert r.status_code == 400
    finally:
        client.cookies.clear()


def test_git_errors_never_carry_repo_token():
    err = GitCommitError("git push failed: fatal: unable to access 'https://ghp_secret@github.com/me/vault.git/'")
    assert "ghp_secret" not in str(err)
    assert redact_credentials("https://user:pw@host/x") == "https://***@host/x"
