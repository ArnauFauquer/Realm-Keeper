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
from services.auth_service import (  # noqa: E402
    SCREEN_COOKIE_NAME, SESSION_COOKIE_NAME, create_screen_key, create_session_token,
)
from services.git_sync_utils import GitCommitError, redact_credentials  # noqa: E402


@pytest.fixture(scope="module")
def client():
    vault = settings.VAULT_PATH
    (vault / "public.md").write_text("# Public\nSee [[secret]] and [[other]].\n", encoding="utf-8")
    (vault / "other.md").write_text("# Other\n", encoding="utf-8")
    outside = _tmp / "outside.md"
    outside.write_text("# Server file\n", encoding="utf-8")
    try:
        (vault / "linked.md").symlink_to(outside)
    except OSError:
        pass  # no symlink privilege (Windows without developer mode)
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


def test_asset_endpoint_cannot_read_other_prefixes(client):
    # Audio lives outside asset-library/ and is behind login on /api/player.
    client.cookies.set(SESSION_COOKIE_NAME, create_session_token("gm@example.com"))
    try:
        r = client.get("/api/asset-library/assets/Combat/boss-theme.mp3")
        assert r.status_code == 400
    finally:
        client.cookies.clear()


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
    # Vite's dev proxy: page on any localhost port, Host rewritten to the backend.
    local = {"Origin": "http://localhost:5174", "Host": "localhost:8000"}
    assert client.post("/api/screen/clear", headers=local).status_code == 401
    spoof = {"Origin": "http://localhost:5174", "Host": "app.example.com"}
    assert client.post("/api/screen/clear", headers=spoof).status_code == 403


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


def test_public_note_does_not_reveal_hidden_link_targets(client):
    note = client.get("/api/note/public").json()
    assert "secret" not in note["links"] and "other" in note["links"]
    assert "/note/secret" not in note["content"] and "/note/other" in note["content"]
    listed = {n["id"]: n for n in client.get("/api/notes").json()}
    assert "secret" not in listed["public"]["links"]


def test_symlinks_out_of_vault_are_not_listed(client):
    if not (settings.VAULT_PATH / "linked.md").is_symlink():
        pytest.skip("symlinks unavailable on this system")
    ids = {n["id"] for n in client.get("/api/notes").json()}
    assert "linked" not in ids
    assert client.get("/api/note/linked").status_code == 404


def test_screen_socket_limit(client, monkeypatch):
    from starlette.websockets import WebSocketDisconnect
    from routes import screen
    monkeypatch.setattr(screen, "MAX_SCREEN_CONNECTIONS", 1)
    client.cookies.set(SCREEN_COOKIE_NAME, create_screen_key("gm@example.com"))
    with client.websocket_connect("/ws/screen"):
        with pytest.raises(WebSocketDisconnect) as exc:
            with client.websocket_connect("/ws/screen") as ws:
                ws.receive_text()
        assert exc.value.code == 1013
    client.cookies.clear()


def test_cookie_secure_follows_frontend_scheme():
    import subprocess

    def secure_flag(**overrides):
        env = {k: v for k, v in os.environ.items() if k != "SESSION_COOKIE_SECURE"}
        env.update(overrides)
        return subprocess.run(
            [sys.executable, "-c", "from config.settings import settings; print(settings.SESSION_COOKIE_SECURE)"],
            env=env, capture_output=True, text=True, cwd=Path(__file__).resolve().parent.parent,
        ).stdout.strip()

    assert secure_flag(FRONTEND_URL="https://app.example.com") == "True"
    assert secure_flag(FRONTEND_URL="http://localhost:5173") == "False"
    assert secure_flag(FRONTEND_URL="https://app.example.com", SESSION_COOKIE_SECURE="false") == "False"


# ── charts, vistas and the asset library: login, or a paired screen ──────

MAP_KEY = "asset-library/maps/tavern.png"
ICON_KEY = "asset-library/icons/pin.png"
OTHER_KEY = "asset-library/maps/dungeon.png"


@pytest.fixture
def screen_state(client, monkeypatch):
    """A chart and a vista on disk, S3 stubbed out, and a clean screen."""
    import json
    from routes import screen

    charts = settings.VAULT_PATH / "_charts" / "tavern"
    charts.mkdir(parents=True, exist_ok=True)
    (charts / "chart.json").write_text(json.dumps({
        "id": "tavern", "name": "Tavern", "image_url": f"/api/asset-library/assets/{MAP_KEY}",
        "pins": [{"id": "p", "x": 1, "y": 1, "name": "p", "icon_url": f"/api/asset-library/assets/{ICON_KEY}"}],
    }), encoding="utf-8")
    vistas = settings.VAULT_PATH / "_vistas" / "night"
    vistas.mkdir(parents=True, exist_ok=True)
    (vistas / "vista.json").write_text(json.dumps({"id": "night", "name": "Night"}), encoding="utf-8")

    class _Body:
        def iter_chunks(self, chunk_size):
            yield b"png"

    monkeypatch.setattr(storage_service, "get_library_asset_stream",
                        lambda key: {"Body": _Body(), "ContentLength": 3})
    monkeypatch.setattr(screen.manager, "current_state", None)
    client.cookies.clear()
    yield screen.manager
    client.cookies.clear()


def _asset(client, key):
    return client.get(f"/api/asset-library/assets/{key}").status_code


def test_library_charts_and_vistas_need_login(client, screen_state):
    for url in ["/api/charts", "/api/charts/tavern", "/api/vistas", "/api/vistas/night",
                "/api/asset-library", f"/api/asset-library/assets/{MAP_KEY}"]:
        r = client.get(url)
        assert r.status_code == 401, url
        # A 401 must never be cached (assets are otherwise cached for a year).
        assert r.headers["cache-control"] == "no-store", url

    client.cookies.set(SESSION_COOKIE_NAME, create_session_token("gm@example.com"))
    assert client.get("/api/charts/tavern").status_code == 200
    assert _asset(client, OTHER_KEY) == 200


def test_paired_screen_sees_only_what_is_on_screen(client, screen_state):
    client.cookies.set(SCREEN_COOKIE_NAME, create_screen_key("gm@example.com"))
    assert client.get("/api/charts/tavern").status_code == 401
    assert _asset(client, MAP_KEY) == 401

    screen_state.current_state = {"type": "display_chart", "chart_id": "tavern"}
    assert client.get("/api/charts/tavern").status_code == 200
    assert _asset(client, MAP_KEY) == 200
    assert _asset(client, ICON_KEY) == 200
    assert _asset(client, OTHER_KEY) == 401            # not part of the chart
    assert client.get("/api/vistas/night").status_code == 401
    assert client.get("/api/charts").status_code == 401  # never the listing

    screen_state.current_state = {
        "type": "display_media", "url": f"https://app.example.com/api/asset-library/assets/{OTHER_KEY}",
    }
    assert _asset(client, OTHER_KEY) == 200
    assert client.get("/api/charts/tavern").status_code == 401

    screen_state.current_state = {"type": "clear_screen"}
    assert _asset(client, OTHER_KEY) == 401


def test_dice_roll_keeps_what_is_on_screen(client, screen_state):
    client.cookies.set(SESSION_COOKIE_NAME, create_session_token("gm@example.com"))
    client.post("/api/screen/chart", json={"chart_id": "tavern"})
    client.post("/api/screen/dice", json={"formula": "1d20", "total": 7})
    assert screen_state.current_state == {"type": "display_chart", "chart_id": "tavern"}


def test_screen_key_rules(client, screen_state):
    screen_state.current_state = {"type": "display_chart", "chart_id": "tavern"}
    # Only a GM can mint one, and it dies with its issuer's access.
    assert client.post("/api/screen/link").status_code == 401
    client.cookies.set(SCREEN_COOKIE_NAME, create_screen_key("former-player@example.com"))
    assert client.get("/api/charts/tavern").status_code == 401
    # A session token isn't a screen key, and vice versa.
    client.cookies.set(SCREEN_COOKIE_NAME, create_session_token("gm@example.com"))
    assert client.get("/api/charts/tavern").status_code == 401
    client.cookies.clear()
    client.cookies.set(SESSION_COOKIE_NAME, create_screen_key("gm@example.com"))
    assert client.get("/api/charts/tavern").status_code == 401


def test_screen_pairing_flow(client, screen_state):
    from starlette.websockets import WebSocketDisconnect

    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect("/ws/screen") as ws:
            ws.receive_text()
    assert exc.value.code == 1008

    client.cookies.set(SESSION_COOKIE_NAME, create_session_token("gm@example.com"))
    key = client.post("/api/screen/link").json()["key"]
    client.cookies.clear()

    assert client.post("/api/screen/pair", json={"key": "forged"}).status_code == 401
    r = client.post("/api/screen/pair", json={"key": key})
    assert r.status_code == 204
    set_cookie = r.headers["set-cookie"].lower()
    assert "httponly" in set_cookie and "secure" in set_cookie
    # The test client talks plain http, so it won't replay a Secure cookie.
    client.cookies.set(SCREEN_COOKIE_NAME, r.cookies[SCREEN_COOKIE_NAME])

    screen_state.current_state = {"type": "display_vista", "vista_id": "night"}
    with client.websocket_connect("/ws/screen") as ws:
        assert ws.receive_json() == {"type": "display_vista", "vista_id": "night"}
    assert client.get("/api/vistas/night").status_code == 200


def test_logout_clears_browser_cache(client):
    assert client.post("/api/auth/logout").headers["clear-site-data"] == '"cache"'


@pytest.mark.parametrize("frontmatter", [
    "tags: [Draft]", "tags: [draft/wip]", 'tags: "npc, draft"', "tags: DRAFT",
])
def test_ignore_tag_variants_are_hidden(client, frontmatter):
    (settings.VAULT_PATH / "variant.md").write_text(f"---\n{frontmatter}\n---\n# V\n", encoding="utf-8")
    from routes.notes import md_service_instance
    md_service_instance.invalidate_cache()
    try:
        assert client.get("/api/note/variant").status_code == 404
        assert "variant" not in {n["id"] for n in client.get("/api/notes").json()}
    finally:
        (settings.VAULT_PATH / "variant.md").unlink()
        md_service_instance.invalidate_cache()


def test_similar_tags_are_not_hidden(client):
    (settings.VAULT_PATH / "drafty.md").write_text("---\ntags: [drafts, redraft]\n---\n# D\n", encoding="utf-8")
    from routes.notes import md_service_instance
    md_service_instance.invalidate_cache()
    try:
        assert client.get("/api/note/drafty").status_code == 200
    finally:
        (settings.VAULT_PATH / "drafty.md").unlink()
        md_service_instance.invalidate_cache()


def test_screen_socket_rejects_foreign_origin(client):
    from starlette.websockets import WebSocketDisconnect
    client.cookies.set(SESSION_COOKIE_NAME, create_session_token("gm@example.com"))
    try:
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect("/ws/screen", headers={"Origin": "https://other.example.com"}) as ws:
                ws.receive_text()
        with client.websocket_connect("/ws/screen", headers={"Origin": "https://app.example.com"}):
            pass
    finally:
        client.cookies.clear()
