"""What is streamed out of S3 (a fake bucket whose bodies are botocore's own
StreamingBody). Run from backend/:  python -m pytest tests/test_storage.py
"""
from fastapi.testclient import TestClient

from main import app
from services.auth_service import SESSION_COOKIE_NAME, create_session_token
from services.doc_backend import S3DocBackend


def test_a_track_streams_whole_and_its_connection_is_released(fake_s3, monkeypatch):
    from routes import player
    from services.player_library import PlayerLibrary

    monkeypatch.setattr(player, "library", PlayerLibrary(S3DocBackend()))
    song = bytes(range(256)) * 1000   # several chunks
    fake_s3.objects["player/Album/song.mp3"] = song
    with TestClient(app) as client:
        client.cookies.set(SESSION_COOKIE_NAME, create_session_token("gm@example.com"))
        response = client.get("/api/player/stream/Album/song.mp3")
    assert response.status_code == 200 and response.content == song


def test_an_image_streams_whole_and_its_body_is_closed(fake_s3):
    fake_s3.objects["observatory/maps/1a2b3c4d-cave.png"] = b"png" * 50_000
    chunks, length = S3DocBackend().open("observatory/maps/1a2b3c4d-cave.png")
    assert length == 150_000 and b"".join(chunks) == b"png" * 50_000
