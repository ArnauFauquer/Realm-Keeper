"""The player's HTTP routes: how a bad name, a failing store and a visitor are
answered. (Streaming and the library itself are in test_player.py.) Run from
backend/:  python -m pytest tests/test_routes_player.py
"""
import pytest
from botocore.exceptions import ClientError
from fastapi.testclient import TestClient

from main import app
from routes import player
from services.auth_service import SESSION_COOKIE_NAME, create_session_token
from services.doc_backend import LocalDocBackend
from services.player_library import PlayerLibrary


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(player, "library", PlayerLibrary(LocalDocBackend(tmp_path)))
    with TestClient(app) as c:
        c.cookies.set(SESSION_COOKIE_NAME, create_session_token("gm@example.com"))
        yield c


def test_a_visitor_cannot_use_the_player(client):
    client.cookies.clear()
    for method, url in (("get", "/api/player/albums"), ("get", "/api/player/stream/a/b.mp3"),
                        ("delete", "/api/player/albums/x"), ("post", "/api/player/albums")):
        assert getattr(client, method)(url).status_code == 401


def test_albums_are_created_renamed_listed_and_deleted(client):
    assert client.post("/api/player/albums", json={"name": "Calm"}).json() == {"status": "success"}
    assert client.put("/api/player/albums/Calm", json={"name": "Quiet"}).json() == {"status": "success"}
    assert client.get("/api/player/albums").json() == {"albums": ["Quiet"]}
    assert client.get("/api/player/albums/Quiet/tracks").json() == {"tracks": []}
    assert client.delete("/api/player/albums/Quiet").json() == {"status": "success"}
    assert client.get("/api/player/albums").json() == {"albums": []}


def test_tracks_are_uploaded_renamed_moved_and_deleted(client):
    up = client.post("/api/player/albums/Calm/tracks", files={"file": ("rain.mp3", b"abc", "audio/mpeg")})
    assert up.status_code == 200
    key = up.json()["key"]
    renamed = client.post("/api/player/tracks/rename", json={"key": key, "name": "storm.mp3"})
    assert renamed.json()["name"] == "storm.mp3"
    moved = client.post("/api/player/tracks/move", json={"key": renamed.json()["key"], "album": "Loud"})
    assert moved.json() == {"key": "Loud/storm.mp3"}
    assert client.get("/api/player/albums/Loud/tracks").json()["tracks"][0]["name"] == "storm.mp3"
    assert client.delete("/api/player/tracks/Loud/storm.mp3").json() == {"status": "success"}
    assert client.get("/api/player/albums/Loud/tracks").json() == {"tracks": []}


@pytest.mark.parametrize("method,url,body", [
    ("post", "/api/player/albums", {"name": ""}),
    ("post", "/api/player/albums", {"name": ".."}),
    ("put", "/api/player/albums/Nope", {"name": "x"}),
    ("post", "/api/player/tracks/move", {"key": "", "album": "x"}),
    ("post", "/api/player/tracks/rename", {"key": "a/none.mp3", "name": "b.mp3"}),
])
def test_a_bad_name_is_the_callers_mistake(client, method, url, body):
    assert getattr(client, method)(url, json=body).status_code == 400


def test_a_file_that_is_not_audio_is_refused(client):
    response = client.post("/api/player/albums/Calm/tracks", files={"file": ("page.html", b"<b>", "text/html")})
    assert response.status_code == 400


def test_a_store_that_fails_is_a_502(client, monkeypatch):
    def down(*args, **kwargs):
        raise ClientError({"Error": {"Code": "500", "Message": "down"}}, "ListObjects")

    monkeypatch.setattr(player.library, "list_albums", down)
    monkeypatch.setattr(player.library, "open_track", down)
    assert client.get("/api/player/albums").status_code == 502
    assert client.get("/api/player/stream/a/b.mp3").status_code == 502

    def disk_full(*args, **kwargs):
        raise OSError("disk full")

    monkeypatch.setattr(player.library, "delete_track", disk_full)
    assert client.delete("/api/player/tracks/a/b.mp3").status_code == 502
