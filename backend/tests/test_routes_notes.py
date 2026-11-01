"""The notes' HTTP routes: what each answers, and what it refuses. The service
is a throwaway vault (the routes' own dependency is swapped), so these don't
touch the shared one. Run from backend/:  python -m pytest tests/test_routes_notes.py
"""
import pytest
from fastapi.testclient import TestClient

from main import app
from routes import notes as notes_routes
from services import markdown_service
from services.auth_service import SESSION_COOKIE_NAME, create_session_token
from services.markdown_service import MarkdownService, NoteSaveError, content_sha


@pytest.fixture
def service(tmp_path, monkeypatch):
    monkeypatch.setattr(markdown_service, "commit_and_push", lambda *a, **kw: None)
    return MarkdownService(vault_path=str(tmp_path / "vault"), ignore_tag="draft", git=False)


@pytest.fixture
def client(service):
    app.dependency_overrides[notes_routes.get_markdown_service] = lambda: service
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.pop(notes_routes.get_markdown_service, None)


@pytest.fixture
def gm(client):
    client.cookies.set(SESSION_COOKIE_NAME, create_session_token("gm@example.com"))
    return client


def _put(client, path, content, **extra):
    return client.put(f"/api/note/{path}", json={"content": content, **extra})


def test_reading_is_public_and_writing_is_not(client):
    assert client.get("/api/notes").status_code == 200
    assert client.get("/api/tags").status_code == 200
    assert _put(client, "Tavern", "x").status_code == 401
    assert client.get("/api/note-raw/Tavern").status_code == 401


def test_saving_creates_then_updates_and_reports_the_new_sha(gm):
    created = _put(gm, "Places/Tavern", "# Tavern\n")
    assert created.status_code == 200
    assert created.json() == {"status": "created", "sha": content_sha("# Tavern\n")}
    updated = _put(gm, "Places/Tavern", "# Tavern 2\n")
    assert updated.json()["status"] == "updated"
    note = gm.get("/api/note/Places/Tavern").json()
    assert note["id"] == "Places/Tavern"
    assert "Tavern 2" in note["content"]


def test_a_save_over_someone_elses_change_is_a_409(gm):
    _put(gm, "Tavern", "one")
    stale = content_sha("one")
    _put(gm, "Tavern", "two")
    conflict = _put(gm, "Tavern", "mine", base_sha=stale)
    assert conflict.status_code == 409
    assert gm.get("/api/note-raw/Tavern").json()["content"] == "two"
    assert _put(gm, "Tavern", "new", base_sha="").status_code == 409   # "must not exist yet"


def test_a_name_that_cannot_be_a_note_is_a_400(gm):
    refused = _put(gm, ".git/config", "x")
    assert refused.status_code == 400
    assert ".git" in refused.json()["detail"]
    assert _put(gm, "%2e%2e/escape", "x").status_code == 400


def test_a_git_that_fails_is_a_502_with_the_reason(gm, service, monkeypatch):
    def fail(*args, **kwargs):
        raise NoteSaveError("git push failed")

    monkeypatch.setattr(service, "save_note", fail)
    response = _put(gm, "Tavern", "x")
    assert response.status_code == 502
    assert response.json()["detail"] == "git push failed"


def test_the_editor_gets_the_raw_file_and_its_sha(gm):
    _put(gm, "Tavern", "---\ntags: [inn]\n---\nBody\n")
    raw = gm.get("/api/note-raw/Tavern").json()
    assert raw["content"].startswith("---")
    assert raw["sha"] == content_sha(raw["content"])
    assert gm.get("/api/note-raw/Missing").status_code == 404


def test_a_note_that_does_not_exist_is_a_404(client):
    assert client.get("/api/note/Missing").status_code == 404


def test_a_path_into_the_repo_internals_is_a_403(client, gm):
    assert client.get("/api/note/.git/config").status_code == 403
    assert gm.get("/api/note-raw/.git/config").status_code == 403


def test_the_listing_pages_and_searches(gm, client):
    for name in ("Alpha", "Beta", "Gamma tavern"):
        _put(gm, name, f"#{'inn' if 'tavern' in name else 'other'}\n")
    client.cookies.clear()
    everything = client.get("/api/notes").json()
    assert [n["id"] for n in everything] == ["Alpha", "Beta", "Gamma tavern"]
    assert [n["id"] for n in client.get("/api/notes?limit=1&offset=1").json()] == ["Beta"]
    assert [n["id"] for n in client.get("/api/notes?search=tavern").json()] == ["Gamma tavern"]
    assert [n["id"] for n in client.get("/api/notes?tags=inn").json()] == ["Gamma tavern"]
    assert client.get("/api/notes?limit=0").status_code == 422
    assert client.get("/api/notes?limit=501").status_code == 422
    assert client.get("/api/notes?offset=-1").status_code == 422


def test_the_tags_and_container_folders_come_from_the_vault(gm, client):
    _put(gm, "Tavern", "#inn #npc\n")
    _put(gm, "Places/Places", "A folder note\n")
    client.cookies.clear()
    assert set(client.get("/api/tags").json()) >= {"inn", "npc"}
    assert isinstance(client.get("/api/container-folders").json(), dict)


def test_the_graph_links_notes_that_link_each_other(gm, client):
    _put(gm, "A", "See [[B]]\n")
    _put(gm, "B", "End\n")
    client.cookies.clear()
    graph = client.get("/api/graph/all").json()
    assert {n["id"] for n in graph["nodes"]} == {"A", "B"}
    assert any({link["source"], link["target"]} == {"A", "B"} for link in graph["links"])


def test_the_home_note_is_the_vaults(gm, client):
    assert client.get("/api/home").json() == {"note": None}
    _put(gm, "index", "# Hi\n")
    assert client.get("/api/home").json() == {"note": "index"}


@pytest.mark.parametrize("method,url", [
    ("get_all_notes", "/api/notes"), ("get_all_tags", "/api/tags"),
    ("get_container_folders", "/api/container-folders"), ("get_graph_data", "/api/graph/all"),
])
def test_a_vault_that_breaks_is_a_500_that_does_not_leak_why(client, service, monkeypatch, method, url):
    def boom(*args, **kwargs):
        raise RuntimeError("/secret/path exploded")

    monkeypatch.setattr(service, method, boom)
    response = client.get(url)
    assert response.status_code == 500
    assert response.json() == {"detail": "Internal server error"}
