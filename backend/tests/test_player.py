"""The audio player's library, in either store (a folder, or S3), and the
byte ranges a track is streamed in. Run from backend/:
    python -m pytest tests/test_player.py
"""
import io

import pytest
from fastapi.testclient import TestClient

from main import app
from services.auth_service import SESSION_COOKIE_NAME, create_session_token
from services.player_library import PlayerLibrary, RangeNotSatisfiable, parse_range
from services.storage_service import StorageError


@pytest.fixture
def library(backend):
    return PlayerLibrary(backend)


def _upload(library, album, name, data=b"mp3"):
    return library.upload_track(album, name, io.BytesIO(data))


def test_albums_and_tracks(library):
    library.create_album("Ambient")
    _upload(library, "Combat", "Boss.mp3", b"x" * 10)
    _upload(library, "Combat", "anthem.ogg")
    assert library.list_albums() == ["Ambient", "Combat"]
    assert library.list_tracks("Ambient") == []
    tracks = library.list_tracks("Combat")
    assert [(t["key"], t["name"]) for t in tracks] == [("Combat/anthem.ogg", "anthem.ogg"), ("Combat/Boss.mp3", "Boss.mp3")]
    assert tracks[1]["size"] == 10 and tracks[1]["last_modified"]


def test_only_audio_is_taken(library):
    with pytest.raises(StorageError):
        _upload(library, "Combat", "page.html")
    with pytest.raises(StorageError):
        _upload(library, "..", "a.mp3")


def test_renaming_and_moving(library):
    _upload(library, "Combat", "boss.mp3")
    _upload(library, "Combat", "other.mp3")
    assert library.rename_track("Combat/boss.mp3", "final boss.mp3") == {"key": "Combat/final boss.mp3", "name": "final boss.mp3"}
    with pytest.raises(StorageError):
        library.rename_track("Combat/other.mp3", "final boss.mp3")   # never over another track
    assert library.move_track("Combat/other.mp3", "Calm") == {"key": "Calm/other.mp3"}
    library.rename_album("Combat", "Fights")
    assert library.list_albums() == ["Calm", "Fights"]
    with pytest.raises(StorageError):
        library.rename_album("Fights", "Calm")
    library.delete_album("Calm")
    library.delete_track("Fights/final boss.mp3")
    assert library.list_albums() == []


def test_a_track_is_read_whole_or_by_range(library):
    _upload(library, "A", "song.mp3", bytes(range(100)))
    whole = library.open_track("A/song.mp3")
    assert whole["length"] == 100 and whole["content_range"] is None
    assert b"".join(whole["chunks"]) == bytes(range(100))
    part = library.open_track("A/song.mp3", "bytes=10-19")
    assert part["content_range"] == "bytes 10-19/100" and b"".join(part["chunks"]) == bytes(range(10, 20))
    assert library.open_track("A/none.mp3") is None


@pytest.mark.parametrize("header,expected", [
    (None, None), ("", None), ("bytes=0-", (0, 99)), ("bytes=10-", (10, 99)), ("bytes=10-20", (10, 20)),
    ("bytes=90-500", (90, 99)), ("bytes=-10", (90, 99)), ("bytes=-500", (0, 99)),
    ("bytes=0-1,5-6", None), ("items=0-5", None), ("bytes=20-10", None),
])
def test_ranges(header, expected):
    assert parse_range(header, 100) == expected


def test_a_range_past_the_end_is_not_satisfiable():
    with pytest.raises(RangeNotSatisfiable):
        parse_range("bytes=100-", 100)


def test_the_player_streams_a_range_from_a_folder(tmp_path, monkeypatch):
    """Without S3, end to end: a seek in a track is a 206 of just those bytes."""
    from routes import player
    from services.doc_backend import LocalDocBackend

    monkeypatch.setattr(player, "library", PlayerLibrary(LocalDocBackend(tmp_path)))
    with TestClient(app) as client:
        client.cookies.set(SESSION_COOKIE_NAME, create_session_token("gm@example.com"))
        upload = client.post("/api/player/albums/Calm/tracks", files={"file": ("rain.mp3", bytes(range(200)), "text/html")})
        assert upload.status_code == 200
        assert client.get("/api/player/albums").json() == {"albums": ["Calm"]}
        seek = client.get("/api/player/stream/Calm/rain.mp3", headers={"Range": "bytes=100-149"})
        assert seek.status_code == 206 and seek.content == bytes(range(100, 150))
        assert seek.headers["content-range"] == "bytes 100-149/200"
        assert seek.headers["content-type"] == "audio/mpeg"   # from the name, never the uploader
        assert client.get("/api/player/stream/Calm/rain.mp3", headers={"Range": "bytes=500-"}).status_code == 416
        assert client.get("/api/player/stream/Calm/none.mp3").status_code == 404
