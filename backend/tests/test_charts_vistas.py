"""Charts and vistas on the generic document layer: what they keep from how they
were stored in git (the vault's `_charts/` and `_vistas/`), and the routes the
frontend and a paired screen rely on. Run from backend/:
    python -m pytest tests/test_charts_vistas.py
"""
import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from routes.auth import require_auth
from routes.doc_router import make_doc_router
from routes.observatory import make_observatory_router
from services.doc_backend import LocalDocBackend
from services.doc_collection import DocCollection
from services.doc_registry import CHART, VISTA, hub
from services.observatory import Observatory

MAP = "/api/observatory/images/cc000001-tavern.png"
ICON = "/api/observatory/images/cc000002-pin.png"
EVIL = "https://evil.example.org/x.png"


def write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def snapshot(root):
    """Every file under `root` and what it holds: to see that nothing changed."""
    return {p.relative_to(root).as_posix(): p.read_bytes() for p in sorted(root.rglob("*")) if p.is_file()}


# ── what the vault used to hold ─────────────────────────────────────────────

CHART_FILE = json.dumps({
    "id": "stale-id", "name": "Tavern", "image_url": MAP,
    "pins": [{"id": "p", "x": 1, "y": 2, "name": "Bar", "icon_url": ICON}],
})


@pytest.fixture
def vault(tmp_path):
    root = tmp_path / "vault"
    write(root / "_charts" / "tavern" / "chart.json", CHART_FILE)
    write(root / "_charts" / "regions" / "north" / "keep" / "chart.json", json.dumps({"id": "x", "name": "Keep"}))
    write(root / "_charts" / "empty" / ".gitkeep", "")
    write(root / "_charts" / "broken" / "chart.json", "{not json")
    write(root / "_charts" / "chart.json", json.dumps({"id": "loose", "name": "Loose"}))  # no folder: no id
    write(root / "_vistas" / "night" / "vista.json", json.dumps({"id": "night", "name": "Night"}))
    write(root / "note.md", "# A note\n")
    return root


def test_the_vaults_charts_and_empty_folders_are_copied(backend, vault):
    charts = DocCollection(CHART, backend)
    assert charts.import_legacy(vault) == 2
    assert sorted(m.id for m in charts.list_all()) == ["regions/north/keep", "tavern"]
    tavern = charts.get("tavern")
    assert (tavern.id, tavern.name, tavern.image_url) == ("tavern", "Tavern", MAP)   # where it is, not the stale id
    assert tavern.pins[0].icon_url == ICON
    assert backend.exists("observatory/empty/.keep")
    assert charts.get("broken") is None                                               # unreadable ones are left out


def test_each_kind_takes_only_its_own_directory(backend, vault):
    vistas = DocCollection(VISTA, backend)
    assert vistas.import_legacy(vault) == 1
    assert [m.id for m in vistas.list_all()] == ["night"]
    assert DocCollection(CHART, backend).list_all() == []


def test_the_vault_is_left_as_it_was(backend, vault):
    before = snapshot(vault)
    DocCollection(CHART, backend).import_legacy(vault)
    DocCollection(VISTA, backend).import_legacy(vault)
    assert snapshot(vault) == before


def test_a_document_already_in_the_store_is_not_replaced(backend, vault):
    charts = DocCollection(CHART, backend)
    charts.write_raw("tavern", {"id": "tavern", "name": "Edited since"})
    assert charts.import_legacy(vault) == 1   # only the other one
    assert charts.get("tavern").name == "Edited since"


def test_it_happens_once_so_a_deleted_document_stays_deleted(backend, vault):
    charts = DocCollection(CHART, backend)
    charts.import_legacy(vault)
    charts.delete("tavern")
    backend.delete_prefix("observatory/empty/")
    assert charts.import_legacy(vault) == 0
    assert charts.get("tavern") is None
    assert not backend.exists("observatory/empty/.keep")
    # ...and a chart added to the vault afterwards is not what this is for.
    write(vault / "_charts" / "late" / "chart.json", json.dumps({"id": "late", "name": "Late"}))
    assert charts.import_legacy(vault) == 0


def test_a_failed_first_try_is_finished_by_the_next(backend, vault, monkeypatch):
    charts = DocCollection(CHART, backend)
    put = backend.put
    seen = []

    def flaky(key, text):
        seen.append(key)
        if key.endswith("regions/north/keep.chart.json"):
            raise OSError("storage went away")
        put(key, text)

    monkeypatch.setattr(backend, "put", flaky)
    with pytest.raises(OSError):
        charts.import_legacy(vault)
    assert not backend.exists("observatory/.charts-imported-from-vault")   # so it is tried again
    monkeypatch.setattr(backend, "put", put)
    charts.import_legacy(vault)
    assert sorted(m.id for m in charts.list_all()) == ["regions/north/keep", "tavern"]
    assert backend.exists("observatory/.charts-imported-from-vault")


def test_without_a_vault_directory_there_is_nothing_to_do_and_nothing_to_mark(backend, tmp_path):
    charts = DocCollection(CHART, backend)
    assert charts.import_legacy(tmp_path / "empty-vault") == 0
    assert not backend.exists("observatory/.charts-imported-from-vault")


def test_kinds_that_were_never_in_the_vault_import_nothing(backend, vault):
    from services.doc_registry import ENCOUNTER
    assert DocCollection(ENCOUNTER, backend).import_legacy(vault) == 0


# ── the routes ──────────────────────────────────────────────────────────────

@pytest.fixture
def api(tmp_path):
    """The real chart and vista routes over a throwaway store; anyone may read."""
    backend = LocalDocBackend(tmp_path)
    charts, vistas = DocCollection(CHART, backend), DocCollection(VISTA, backend)
    app = FastAPI()
    app.include_router(make_doc_router(CHART, charts, hub, viewer=lambda request, doc_id: None))
    app.include_router(make_doc_router(VISTA, vistas, hub, viewer=lambda request, doc_id: None))
    observatory = Observatory(backend, {"chart": charts, "vista": vistas})
    app.include_router(make_observatory_router(observatory, hub, {}, image_viewer=lambda request, name: None))
    app.dependency_overrides[require_auth] = lambda: {"email": "gm@example.com", "name": "GM"}
    with TestClient(app) as client:
        yield client


def test_a_chart_is_created_listed_saved_and_read_back(api):
    created = api.post("/api/charts", json={"name": "Tavern Map", "folder_path": "regions"}).json()
    assert (created["id"], created["pins"], created["image_url"]) == ("regions/tavern-map", [], None)

    saved = api.put("/api/charts/regions/tavern-map", json={
        "name": "Tavern", "description": "Where it starts",
        "pins": [{"id": "p", "x": 1, "y": 2, "name": "Bar", "icon_url": ICON}],
        "paths": [{"id": "r", "points": [{"x": 0, "y": 0}, {"x": 5, "y": 5}], "direction": "none"}],
        "annotations": [{"id": "a", "x": 3, "y": 3, "text": "Here"}],
    }).json()
    assert saved["name"] == "Tavern" and saved["paths"][0]["direction"] == "none"
    assert api.get("/api/charts/regions/tavern-map").json() == saved
    assert api.get("/api/charts/regions/nothing").status_code == 404

    tree = api.get("/api/observatory", params={"path": "regions"}).json()
    assert [(c["kind"], c["id"]) for c in tree["items"]] == [("chart", "regions/tavern-map")]
    assert tree["items"][0]["name"] == "Tavern" and "pins" not in tree["items"][0]
    assert api.get("/api/observatory").json() == {"folders": ["regions"], "items": []}


def test_a_chart_s_map_is_only_set_through_its_own_route(api):
    api.post("/api/charts", json={"name": "Tavern"})
    assert api.post("/api/charts/tavern/image", json={"url": MAP}).json()["image_url"] == MAP
    assert api.post("/api/charts/tavern/image", json={"url": EVIL}).status_code == 400
    assert api.post("/api/charts/ghost/image", json={"url": MAP}).status_code == 404

    # A save can't change it, nor does it lose it.
    saved = api.put("/api/charts/tavern", json={"name": "Tavern", "image_url": "/api/observatory/images/cc000009-other.png"}).json()
    assert saved["image_url"] == MAP


def test_images_that_are_not_from_the_library_are_refused_and_nothing_is_saved(api):
    api.post("/api/charts", json={"name": "Tavern"})
    bad = {"name": "Changed", "pins": [{"id": "p", "x": 1, "y": 1, "name": "p", "icon_url": EVIL}]}
    assert api.put("/api/charts/tavern", json=bad).status_code == 400
    assert api.get("/api/charts/tavern").json()["name"] == "Tavern"

    api.post("/api/vistas", json={"name": "Night"})
    asset = {"id": "a", "name": "Orc", "image_url": EVIL}
    assert api.put("/api/vistas/night", json={"name": "Night", "assets": [asset]}).status_code == 400
    assert api.post("/api/vistas/night/background", json={"url": EVIL}).status_code == 400
    assert api.get("/api/vistas/night").json()["assets"] == []


def test_a_vista_keeps_its_stage_and_its_background_route(api):
    api.post("/api/vistas", json={"name": "Night", "folder_path": "tavern"})
    assert api.post("/api/vistas/tavern/night/background", json={"url": MAP}).json()["background_url"] == MAP
    saved = api.put("/api/vistas/tavern/night", json={
        "name": "Night", "vanishing_point": {"x": 40, "y": 30}, "background_offset_y": 20,
        "assets": [{"id": "a", "name": "Orc", "image_url": ICON, "x": 10, "y": 80, "flip_h": True}],
    }).json()
    assert (saved["vanishing_point"], saved["background_offset_y"]) == ({"x": 40, "y": 30}, 20)
    assert saved["assets"][0]["flip_h"] is True
    assert saved["background_url"] == MAP
    assert api.get("/api/observatory", params={"path": "tavern"}).json()["items"][0]["background_url"] == MAP


def test_charts_and_vistas_are_moved_renamed_and_deleted_by_id(api):
    api.post("/api/charts", json={"name": "Tavern"})
    api.post("/api/observatory/folders", json={"path": "regions"})
    assert api.post("/api/charts/move", json={"id": "tavern", "folder_path": "regions"}).json() == {
        "status": "success", "id": "regions/tavern",
    }
    assert api.post("/api/charts/rename", json={"id": "regions/tavern", "name": "The Tavern"}).json()["name"] == "The Tavern"
    assert api.put("/api/observatory/folders/regions", json={"name": "north"}).json() == {"status": "success"}
    assert api.get("/api/charts/north/tavern").json()["name"] == "The Tavern"
    assert api.delete("/api/charts/north/tavern").json() == {"status": "success"}
    assert api.get("/api/charts/north/tavern").status_code == 404
    assert api.delete("/api/charts/north/tavern").status_code == 404
    assert api.get("/api/vistas/all").json() == {"vistas": []}


def test_a_chart_may_be_called_what_a_route_is_called(api):
    for name in ("Image", "All", "Move"):
        assert api.post("/api/charts", json={"name": name}).status_code == 200
    ids = sorted(c["id"] for c in api.get("/api/charts/all").json()["charts"])
    assert ids == ["all-2", "image-2", "move-2"]
    assert api.get("/api/charts/all-2").status_code == 200


def test_the_charts_and_vistas_routes_are_the_real_ones():
    """The app serves what make_doc_router and make_observatory_router build."""
    from main import app
    paths = app.openapi()["paths"]
    for url in ("/api/charts/all", "/api/charts/{doc_id}/image", "/api/vistas/{doc_id}/background",
                "/api/vistas/move", "/api/vistas/rename", "/api/observatory", "/api/observatory/folders/move",
                "/api/observatory/images/{name}", "/api/observatory/export", "/api/observatory/import"):
        assert url in paths, url
