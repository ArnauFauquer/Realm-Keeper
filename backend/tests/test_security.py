"""Regression tests for access-control and injection fixes. Run from backend/:
    python -m pytest tests/test_security.py
"""
import os
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from config.settings import settings
from main import app
from services import storage_service
from services.auth_service import (
    SCREEN_COOKIE_NAME, SESSION_COOKIE_NAME, create_screen_key, create_session_token,
)
from services.git_sync_utils import GitCommitError, redact_credentials

# The throwaway folder tests/conftest.py pointed the vault, logs and documents into.
_tmp = Path(settings.VAULT_PATH).parent


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


def test_track_keys_cannot_reach_beyond_the_player(monkeypatch):
    """Whatever a track key says, it names something under player/: not the
    asset library, not a document."""
    reached = []
    monkeypatch.setattr(storage_service, "_get_object_stream", lambda key, range_header=None: reached.append(key))
    storage_service.get_track_stream("asset-library/map.png")
    storage_service.get_track_stream("charts/chart.json")
    assert reached == ["player/asset-library/map.png", "player/charts/chart.json"]
    for key in ("../x/y.mp3", "a/../y.mp3", "a/b/c.mp3", "chart.json", "/a.mp3"):
        with pytest.raises(storage_service.StorageError):
            storage_service.get_track_stream(key)


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
        vista = client.post("/api/vistas", json={"name": "Whatever"}).json()
        evil = "https://evil.example.org/x.svg"
        r = client.put(f"/api/vistas/{vista['id']}", json={
            "name": "x", "assets": [{"id": "a", "name": "a", "image_url": evil}],
        })
        assert r.status_code == 400
        assert client.post(f"/api/vistas/{vista['id']}/background", json={"url": evil}).status_code == 400
        assert client.get(f"/api/vistas/{vista['id']}").json()["assets"] == []   # nothing was saved
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
    """A chart and a vista in the document store, S3 stubbed out, and a clean screen."""
    from routes import screen
    from services.doc_registry import chart_collection, vista_collection

    chart_collection.write_raw("tavern", {
        "id": "tavern", "name": "Tavern", "image_url": f"/api/asset-library/assets/{MAP_KEY}",
        "pins": [{"id": "p", "x": 1, "y": 1, "name": "p", "icon_url": f"/api/asset-library/assets/{ICON_KEY}"}],
    })
    vista_collection.write_raw("night", {"id": "night", "name": "Night"})

    class _Body:
        def iter_chunks(self, chunk_size):
            yield b"png"

    monkeypatch.setattr(storage_service, "get_library_asset_stream",
                        lambda key: {"Body": _Body(), "ContentLength": 3})
    monkeypatch.setattr(screen.manager, "current_state", None)
    monkeypatch.setattr(screen.manager, "live_draft", None)
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


def test_what_a_screen_may_read_is_looked_up_once_per_thing_shown(client, screen_state, monkeypatch):
    """A scene has dozens of images and a screen asks for each: the chart is
    read from the store when it is sent, not again for every image."""
    from routes import screen_access
    from services.doc_registry import chart_collection

    reads = []
    real_get = chart_collection.get

    def counting_get(doc_id):
        reads.append(doc_id)
        return real_get(doc_id)

    monkeypatch.setattr(chart_collection, "get", counting_get)
    client.cookies.set(SCREEN_COOKIE_NAME, create_screen_key("gm@example.com"))

    screen_state.current_state = {"type": "display_chart", "chart_id": "tavern"}
    assert [_asset(client, key) for key in (MAP_KEY, ICON_KEY, MAP_KEY)] == [200, 200, 200]
    assert reads == ["tavern"]

    # Sent again, it is read again: a GM who saved a new icon and sends it sees it.
    screen_state.current_state = {"type": "display_chart", "chart_id": "tavern"}
    assert _asset(client, MAP_KEY) == 200
    assert len(reads) == 2

    # Saved while it is shown: picked up once the answer has aged.
    chart_collection.write_raw("tavern", {"id": "tavern", "name": "Tavern", "image_url": f"/api/asset-library/assets/{OTHER_KEY}"})
    assert _asset(client, OTHER_KEY) == 401
    screen_access._shown["until"] = 0
    assert _asset(client, OTHER_KEY) == 200
    assert _asset(client, MAP_KEY) == 401


def test_dice_roll_keeps_what_is_on_screen(client, screen_state):
    client.cookies.set(SESSION_COOKIE_NAME, create_session_token("gm@example.com"))
    client.post("/api/screen/chart", json={"chart_id": "tavern"})
    client.post("/api/screen/dice", json={"formula": "1d20", "total": 7})
    assert screen_state.current_state == {"type": "display_chart", "chart_id": "tavern"}


LIVE_ASSET = "asset-library/props/unsaved-orc.png"


def _gm(client):
    client.cookies.set(SESSION_COOKIE_NAME, create_session_token("gm@example.com"))


def test_live_edit_is_ignored_unless_that_item_is_on_screen(client, screen_state):
    _gm(client)
    body = {"vista_id": "night", "assets": []}
    assert client.post("/api/screen/vista/live", json=body).json() == {"status": "ignored"}
    assert screen_state.live_draft is None

    client.post("/api/screen/chart", json={"chart_id": "tavern"})
    assert client.post("/api/screen/vista/live", json=body).json() == {"status": "ignored"}
    assert client.post("/api/screen/chart/live", json={"chart_id": "other"}).json() == {"status": "ignored"}
    assert screen_state.live_draft is None


def test_live_edit_rides_beside_what_is_on_screen(client, screen_state):
    _gm(client)
    client.post("/api/screen/vista", json={"vista_id": "night"})
    asset = {"id": "a", "name": "Orc", "image_url": f"/api/asset-library/assets/{LIVE_ASSET}", "x": 12}
    r = client.post("/api/screen/vista/live", json={"vista_id": "night", "assets": [asset]})
    assert r.json() == {"status": "success"}

    # The pointer stays what screen_access reads; the draft doesn't replace it.
    assert screen_state.current_state == {"type": "display_vista", "vista_id": "night"}
    assert screen_state.live_draft["type"] == "update_vista"
    assert screen_state.live_draft["assets"][0]["x"] == 12

    # A screen connecting mid-edit gets the pointer, then the draft.
    with client.websocket_connect("/ws/screen") as ws:
        assert ws.receive_json()["type"] == "display_vista"
        assert ws.receive_json()["assets"][0]["id"] == "a"

    # Sending anything else replaces the screen, and the draft goes with it.
    client.post("/api/screen/clear")
    assert screen_state.live_draft is None


def test_live_edit_keeps_unsaved_images_readable_by_the_screen(client, screen_state):
    _gm(client)
    client.post("/api/screen/chart", json={"chart_id": "tavern"})
    pin = {"id": "p", "x": 1, "y": 1, "name": "p", "icon_url": f"/api/asset-library/assets/{LIVE_ASSET}"}
    client.post("/api/screen/chart/live", json={"chart_id": "tavern", "pins": [pin]})
    client.cookies.clear()

    client.cookies.set(SCREEN_COOKIE_NAME, create_screen_key("gm@example.com"))
    assert _asset(client, LIVE_ASSET) == 200
    assert _asset(client, OTHER_KEY) == 401


def test_live_edit_only_draws_library_images(client, screen_state):
    _gm(client)
    client.post("/api/screen/vista", json={"vista_id": "night"})
    evil = {"id": "a", "name": "a", "image_url": "https://evil.example.org/x.svg"}
    assert client.post("/api/screen/vista/live", json={"vista_id": "night", "assets": [evil]}).status_code == 400
    r = client.post("/api/screen/vista/live", json={"vista_id": "night", "background_url": "https://evil.example.org/x"})
    assert r.status_code == 400
    assert screen_state.live_draft is None


def test_live_edit_needs_login(client, screen_state):
    screen_state.current_state = {"type": "display_vista", "vista_id": "night"}
    assert client.post("/api/screen/vista/live", json={"vista_id": "night"}).status_code == 401
    assert client.post("/api/screen/chart/live", json={"chart_id": "tavern"}).status_code == 401


def test_dice_slot_follows_allowlist_order(client, monkeypatch):
    monkeypatch.setattr(settings, "ALLOWED_EMAILS", ["gm@example.com", "ana@example.com"])
    for email, slot in [("gm@example.com", 0), ("ana@example.com", 1)]:
        client.cookies.set(SESSION_COOKIE_NAME, create_session_token(email))
        try:
            assert client.get("/api/auth/me").json()["diceSlot"] == slot
        finally:
            client.cookies.clear()


def test_dice_roll_carries_the_rollers_slot(client, screen_state, monkeypatch):
    monkeypatch.setattr(settings, "ALLOWED_EMAILS", ["gm@example.com", "ana@example.com"])
    sent = []

    async def capture(message):
        sent.append(message)

    monkeypatch.setattr(screen_state, "broadcast", capture)
    client.cookies.set(SESSION_COOKIE_NAME, create_session_token("ana@example.com"))
    # The colour comes from the session: a client can't claim someone else's.
    client.post("/api/screen/dice", json={"formula": "1d20", "total": 7, "diceSlot": 0})
    assert sent[0]["diceSlot"] == 1


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


# ── constellation on the screen ──────────────────────────────────────────

CONSTELLATION = {
    "view": {"x": -120.5, "y": 40, "k": 1.8, "width": 1200, "height": 700},
    "positions": {"World/Wei": [10.5, -3], "Calendario": [200, 80]},
    "highlighted_type": "npc",
    "hover_id": "Calendario",
}


def test_constellation_needs_login(client, screen_state):
    assert client.post("/api/screen/constellation", json=CONSTELLATION).status_code == 401
    assert client.post("/api/screen/constellation/live", json=CONSTELLATION).status_code == 401
    assert screen_state.current_state is None


def test_constellation_is_shown_as_the_screen_content(client, screen_state):
    _gm(client)
    assert client.post("/api/screen/constellation", json=CONSTELLATION).json() == {"status": "success"}
    state = screen_state.current_state
    assert state["type"] == "display_constellation"
    assert state["view"]["k"] == 1.8
    assert state["positions"]["World/Wei"] == (10.5, -3.0)
    assert state["highlighted_type"] == "npc"

    # A screen that connects later gets the frozen constellation straight away.
    with client.websocket_connect("/ws/screen") as ws:
        message = ws.receive_json()
        assert message["type"] == "display_constellation"
        assert message["positions"]["Calendario"] == [200.0, 80.0]


def test_constellation_live_is_ignored_unless_it_is_on_screen(client, screen_state):
    _gm(client)
    assert client.post("/api/screen/constellation/live", json=CONSTELLATION).json() == {"status": "ignored"}
    assert screen_state.live_draft is None

    client.post("/api/screen/chart", json={"chart_id": "tavern"})
    assert client.post("/api/screen/constellation/live", json=CONSTELLATION).json() == {"status": "ignored"}
    assert screen_state.live_draft is None


def test_constellation_live_rides_beside_the_shown_constellation(client, screen_state):
    _gm(client)
    client.post("/api/screen/constellation", json=CONSTELLATION)
    moved = {**CONSTELLATION, "view": {**CONSTELLATION["view"], "k": 3}, "hover_id": None}
    assert client.post("/api/screen/constellation/live", json=moved).json() == {"status": "success"}

    assert screen_state.current_state["type"] == "display_constellation"
    assert screen_state.live_draft["type"] == "update_constellation"
    assert screen_state.live_draft["view"]["k"] == 3

    # A screen connecting mid-session gets the base, then the latest live state.
    with client.websocket_connect("/ws/screen") as ws:
        assert ws.receive_json()["type"] == "display_constellation"
        assert ws.receive_json()["view"]["k"] == 3

    # Showing anything else drops the draft with it.
    client.post("/api/screen/clear")
    assert screen_state.live_draft is None


def test_constellation_rejects_nonsense(client, screen_state):
    _gm(client)
    bad_zoom = {**CONSTELLATION, "view": {**CONSTELLATION["view"], "k": 0}}
    assert client.post("/api/screen/constellation", json=bad_zoom).status_code == 422
    no_positions = {key: value for key, value in CONSTELLATION.items() if key != "positions"}
    assert client.post("/api/screen/constellation", json=no_positions).status_code == 422
    assert screen_state.current_state is None


def test_constellation_does_not_change_what_a_paired_screen_may_read(client, screen_state):
    _gm(client)
    client.post("/api/screen/constellation", json=CONSTELLATION)
    client.cookies.clear()
    client.cookies.set(SCREEN_COOKIE_NAME, create_screen_key("gm@example.com"))
    assert _asset(client, MAP_KEY) == 401
    assert client.get("/api/charts/tavern").status_code == 401
