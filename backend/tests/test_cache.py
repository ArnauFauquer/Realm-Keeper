"""What each response may be cached as. Run from backend/:
    python -m pytest tests/test_cache.py
"""
import pytest

from config.cache import CacheControlMiddleware

policy = CacheControlMiddleware._get_cache_control


@pytest.mark.parametrize("path", ["/api/note/Tavern", "/api/notes", "/api/tags", "/api/graph/all", "/api/container-folders"])
def test_the_public_notes_are_kept_but_always_checked_again(path):
    # A note saved, created or pulled must show at once, not minutes later.
    assert policy(path, "GET") == "public, no-cache"


@pytest.mark.parametrize("path", [
    "/api/note-raw/Tavern", "/api/charts/tavern", "/api/encounters/fight", "/api/characters/aria",
    "/api/observatory", "/api/player/albums", "/api/auth/me", "/api/sheets",
    "/api/some-kind-added-later/x",   # safe without being listed
])
def test_everything_else_under_the_api_is_never_kept(path):
    assert policy(path, "GET") == "no-store, must-revalidate"


def test_images_and_assets_are_kept_for_good():
    assert policy("/api/observatory/images/1a2b3c4d-map.png", "GET") == "private, max-age=31536000, immutable"
    assert policy("/assets/index-abc.js", "GET") == "public, max-age=31536000, immutable"


@pytest.mark.parametrize("method", ["POST", "PUT", "PATCH", "DELETE"])
def test_writes_are_never_kept(method):
    assert "no-store" in policy("/api/note/Tavern", method)
