"""The Observatory: one tree of folders for every document and image, its
routes, the backup as a zip, and the one-time move of a bucket into it.
Run from backend/:  python -m pytest tests/test_observatory.py
"""
import io
import json
import zipfile

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from routes.auth import require_auth
from routes.doc_router import make_doc_router
from routes.observatory import make_observatory_router
from scripts import migrate_to_observatory as migration
from services.doc_backend import LocalDocBackend
from services.doc_collection import DocCollection, DocNotFound
from services.doc_registry import CHART, ENCOUNTER, VISTA, hub
from services.observatory import Observatory, image_display_name, image_uid, image_url
from tests.conftest import FakeS3

PNG = b"\x89PNG\r\n\x1a\nfake"


def make_observatory(backend):
    collections = {doctype.kind: DocCollection(doctype, backend) for doctype in (CHART, VISTA, ENCOUNTER)}
    return Observatory(backend, collections)


@pytest.fixture
def observatory(tmp_path):
    return make_observatory(LocalDocBackend(tmp_path / "store"))


def upload(observatory, folder, name, data=PNG):
    report = observatory.import_files(folder, [(name, io.BytesIO(data))])
    if report["skipped"]:
        raise ValueError(report["skipped"][0]["reason"])
    return report["items"][0]


# ── names ───────────────────────────────────────────────────────────────────

def test_an_image_is_named_by_its_uid():
    assert image_uid("1a2b3c4d-cave map.png") == "1a2b3c4d"
    assert image_uid("cave.png") is None and image_uid("1A2B3C4D-x.png") is None
    assert image_display_name("1a2b3c4d-cave map.png") == "cave map.png"
    assert image_url("1a2b3c4d-Mapa (1) ñ.png") == "/api/observatory/images/1a2b3c4d-Mapa%20%281%29%20%C3%B1.png"


# ── one tree for everything ─────────────────────────────────────────────────

def test_a_folder_holds_documents_of_every_kind_and_images(observatory):
    charts, vistas, encounters = (observatory.collections[k] for k in ("chart", "vista", "encounter"))
    charts.create("Ambush", folder_path="act 2")
    encounters.create("Ambush", folder_path="act 2")   # the same name, another kind: side by side
    vistas.create("Tavern", folder_path="act 2")
    image = upload(observatory, "act 2", "map.png")
    observatory.create_folder("act 2/maps")
    charts.create("Elsewhere")

    listing = observatory.list("act 2")
    assert listing["folders"] == ["maps"]
    assert [(i["kind"], i["id"], i["name"]) for i in listing["items"]] == [
        ("chart", "act 2/ambush", "Ambush"),
        ("encounter", "act 2/ambush", "Ambush"),
        ("image", image["id"], "map.png"),
        ("vista", "act 2/tavern", "Tavern"),
    ]
    assert image["url"] == image_url(image["id"]) and image["folder"] == "act 2"
    assert observatory.list("")["folders"] == ["act 2"]
    assert [i["id"] for i in observatory.list("")["items"]] == ["elsewhere"]


def test_everything_of_one_kind_wherever_it_is(observatory):
    charts = observatory.collections["chart"]
    charts.create("Zed", folder_path="act 2/caves")
    charts.create("Alpha")
    observatory.collections["vista"].create("Not a chart", folder_path="act 2")
    upload(observatory, "act 2", "map.png")
    assert [(i["id"], i["folder"]) for i in observatory.list_kind("chart")["items"]] == [("alpha", ""), ("act 2/caves/zed", "act 2/caves")]
    assert [(i["name"], i["folder"]) for i in observatory.list_kind("image")["items"]] == [("map.png", "act 2")]
    with pytest.raises(ValueError):
        observatory.list_kind("song")


def test_searching_finds_every_kind_by_name_place_and_tags(observatory):
    observatory.collections["chart"].create("La Ciénaga", folder_path="Hijos del Fango")
    observatory.collections["encounter"].create("Emboscada en la ciénaga")
    observatory.collections["vista"].create("Taberna", folder_path="Hijos del Fango")
    upload(observatory, "Mapas", "cienaga norte.png")
    found = observatory.search("cienaga")
    assert sorted((i["kind"], i["name"]) for i in found) == [
        ("chart", "La Ciénaga"), ("encounter", "Emboscada en la ciénaga"), ("image", "cienaga norte.png"),
    ]
    assert found[0]["name"] == "cienaga norte.png"                       # starts with it: first
    assert [i["name"] for i in observatory.search("fango taberna")] == ["Taberna"]   # every word, place too
    assert observatory.search("   ") == [] and observatory.search("dragon") == []


def test_a_folder_moves_and_goes_with_everything_in_it(observatory):
    encounters = observatory.collections["encounter"]
    encounters.create("Fight", folder_path="act 2/caves")
    image = upload(observatory, "act 2", "map.png")
    observatory.create_folder("campaign")

    moves = observatory.move_folder("act 2", new_parent_path="campaign")
    assert moves == {"encounter": {"act 2/caves/fight": "campaign/act 2/caves/fight"}}
    assert encounters.get("campaign/act 2/caves/fight").name == "Fight"
    assert observatory.image_key(image["id"]) == f"observatory/campaign/act 2/{image['id']}"   # its URL still works

    assert observatory.move_folder("campaign/act 2", new_name="act II") == {
        "encounter": {"campaign/act 2/caves/fight": "campaign/act II/caves/fight"},
    }
    with pytest.raises(ValueError):
        observatory.move_folder("campaign", new_parent_path="campaign/act II")
    with pytest.raises(ValueError):
        observatory.create_folder("campaign")
    assert observatory.delete_folder("campaign") == {"encounter": ["campaign/act II/caves/fight"]}
    assert observatory.list("") == {"folders": [], "items": []}
    assert observatory.image_key(image["id"]) is None
    with pytest.raises(DocNotFound):
        observatory.delete_folder("campaign")


def test_an_image_keeps_its_uid_when_renamed_or_moved(observatory):
    image = upload(observatory, "maps", "cave.png")
    uid = image_uid(image["id"])
    renamed = observatory.rename_image(image["id"], "big cave.png")
    assert renamed["id"] == f"{uid}-big cave.png"
    moved = observatory.move_image(renamed["id"], "act 1")
    assert moved["folder"] == "act 1"
    # The old URL, with the old name, still finds it: only the uid counts.
    chunks, length, content_type = observatory.open_image(image["id"])
    assert (b"".join(chunks), length, content_type) == (PNG, len(PNG), "image/png")
    with pytest.raises(ValueError):
        observatory.rename_image(moved["id"], "cave.html")
    observatory.delete_image(moved["id"])
    with pytest.raises(DocNotFound):
        observatory.open_image(image["id"])


def test_every_upload_gets_a_uid_of_its_own(observatory):
    first, second = upload(observatory, "", "cave.png"), upload(observatory, "", "cave.png", b"other")
    assert first["id"] != second["id"] and first["name"] == second["name"] == "cave.png"
    with pytest.raises(ValueError):
        upload(observatory, "", "page.html")
    with pytest.raises(ValueError):
        upload(observatory, "../up", "cave.png")


def test_an_image_put_there_by_another_process_is_found(observatory):
    upload(observatory, "", "first.png")   # the index has been read
    observatory.backend.put_file("observatory/elsewhere/0f0f0f0f-late.png", io.BytesIO(PNG), "image/png")
    assert observatory.image_key("0f0f0f0f-late.png") is None   # just read: not again at once
    observatory._index_read_at -= 10
    assert observatory.image_key("0f0f0f0f-late.png") == "observatory/elsewhere/0f0f0f0f-late.png"


# ── export and import ───────────────────────────────────────────────────────

def _zip(entries):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, data in entries.items():
            archive.writestr(name, data)
    buffer.seek(0)
    return buffer


def _items(report):
    return sorted((item["kind"], item["id"]) for item in report["items"])


def test_an_exported_folder_is_imported_into_any_folder(observatory, tmp_path):
    charts = observatory.collections["chart"]
    image = upload(observatory, "act 2", "map.png")
    chart = charts.create("Tavern", folder_path="act 2")
    charts.set_field(chart.id, "image_url", image["url"])
    observatory.collections["encounter"].create("Fight", folder_path="act 2/caves")
    observatory.create_folder("act 2/empty")
    observatory.collections["chart"].create("Elsewhere")

    exported = io.BytesIO()
    assert observatory.export_zip(exported, "act 2") == 4
    names = sorted(zipfile.ZipFile(exported).namelist())
    assert names == sorted(["tavern.chart.json", image["id"], "caves/fight.encounter.json", "empty/.keep"])

    # On another instance: everything comes back as it was, inside the folder it is imported into.
    elsewhere = make_observatory(LocalDocBackend(tmp_path / "other"))
    exported.seek(0)
    report = elsewhere.import_files("campaign", [("act 2.zip", exported)])
    assert report["skipped"] == []
    assert _items(report) == [("chart", "campaign/tavern"), ("encounter", "campaign/caves/fight"), ("image", image["id"])]
    assert elsewhere.collections["chart"].get("campaign/tavern").image_url == image["url"]   # its image kept its uid
    chunks, _length, _type = elsewhere.open_image(image["id"])
    assert b"".join(chunks) == PNG
    assert elsewhere.list("campaign")["folders"] == ["caves", "empty"]


def test_importing_never_replaces_what_is_there(observatory):
    image = upload(observatory, "act 2", "map.png")
    observatory.collections["chart"].create("Tavern", folder_path="act 2")
    exported = io.BytesIO()
    observatory.export_zip(exported, "act 2")
    exported.seek(0)
    report = observatory.import_files("act 2", [("again.zip", exported)])
    # A copy of each: the chart under the next free slug, the image under a new uid.
    chart_ids = [i["id"] for i in report["items"] if i["kind"] == "chart"]
    image_ids = [i["id"] for i in report["items"] if i["kind"] == "image"]
    assert chart_ids == ["act 2/tavern-2"]
    assert image_ids != [image["id"]] and image_display_name(image_ids[0]) == "map.png"
    assert len(observatory.list("act 2")["items"]) == 4


def test_documents_and_images_are_imported_one_by_one(observatory):
    report = observatory.import_files("act 2", [
        ("La Taberna.vista.json", io.BytesIO(json.dumps({"name": "La taberna", "assets": []}).encode())),
        ("sin nombre.chart.json", io.BytesIO(b'{"pins": []}')),
        ("cave.png", io.BytesIO(PNG)),
        ("1a2b3c4d-kept.png", io.BytesIO(PNG)),
        ("notes.txt", io.BytesIO(b"hi")),
        ("tavern.json", io.BytesIO(b"{}")),
        ("broken.chart.json", io.BytesIO(b"{not json")),
        ("evil.chart.json", io.BytesIO(json.dumps({"name": "Evil", "image_url": "https://evil.example/x.png"}).encode())),
        ("list.vista.json", io.BytesIO(b"[]")),
    ])
    kinds = {(i["kind"], i["name"]) for i in report["items"]}
    assert kinds >= {("vista", "La taberna"), ("chart", "sin-nombre"), ("image", "cave.png"), ("image", "kept.png")}
    assert len(report["items"]) == 4
    assert {s["path"] for s in report["skipped"]} == {"notes.txt", "tavern.json", "broken.chart.json", "evil.chart.json", "list.vista.json"}
    assert observatory.collections["vista"].get("act 2/la-taberna").name == "La taberna"
    assert "1a2b3c4d-kept.png" in [i["id"] for i in report["items"]]                    # a free uid is kept
    assert image_uid(next(i["id"] for i in report["items"] if i["name"] == "cave.png"))  # none: it gets one


def test_a_zip_takes_only_what_belongs_in_the_tree(observatory, monkeypatch):
    report = observatory.import_files("", [("odd.zip", _zip({
        "../escape.chart.json": json.dumps({"name": "x"}),
        ".hidden/x.chart.json": json.dumps({"name": "x"}),
        "ok/fine.vista.json": json.dumps({"name": "Fine"}),
    })), ("not.zip", io.BytesIO(b"nope"))])
    assert _items(report) == [("vista", "ok/fine")]
    assert {s["path"] for s in report["skipped"]} == {"../escape.chart.json", ".hidden/x.chart.json", "not.zip"}
    from services import observatory as module
    monkeypatch.setattr(module, "MAX_IMPORT_FILES", 2)
    report = observatory.import_files("", [("big.zip", _zip({"a.png": PNG, "b.png": PNG, "c.png": PNG}))])
    assert report["items"] == [] and "at most" in report["skipped"][0]["reason"]


def test_a_damaged_zip_entry_is_left_out_not_the_whole_import(observatory):
    archive = _zip({"good.vista.json": json.dumps({"name": "Good"}), "bad.vista.json": json.dumps({"name": "Bad"})})
    raw = bytearray(archive.getvalue())
    # Corrupt the second entry's data, so reading it fails its CRC check (a BadZipFile, not a ValueError).
    at = raw.index(b'{"name": "Bad"}')
    raw[at + 10] ^= 0xFF
    report = observatory.import_files("", [("damaged.zip", io.BytesIO(bytes(raw)))])
    assert _items(report) == [("vista", "good")]
    assert [s["path"] for s in report["skipped"]] == ["bad.vista.json"]


def test_a_document_larger_than_a_document_may_be_is_not_read_whole(observatory):
    huge = json.dumps({"name": "Huge", "description": "x" * 2_000_000})
    report = observatory.import_files("", [("huge.vista.json", io.BytesIO(huge.encode()))])
    assert report["items"] == [] and "too large" in report["skipped"][0]["reason"]


def test_a_folder_cannot_take_a_document_into_a_folder_named_like_its_lists(observatory):
    observatory.collections["encounter"].create("Fight", folder_path="act 2")
    observatory.create_folder("maps")
    with pytest.raises(ValueError, match="combatants"):
        observatory.move_folder("act 2", new_name="combatants")
    with pytest.raises(ValueError, match="combatants"):
        observatory.move_folder("act 2", new_parent_path="maps/combatants")
    assert observatory.collections["encounter"].get("act 2/fight") is not None


def test_a_folder_moves_where_an_empty_one_was_left(observatory, tmp_path):
    observatory.collections["chart"].create("Tavern", folder_path="old")
    (tmp_path / "store" / "observatory" / "new" / "empty").mkdir(parents=True)
    observatory.move_folder("old", new_name="new")
    assert observatory.collections["chart"].get("new/tavern") is not None


def test_a_delete_the_store_could_only_partly_do_is_an_error():
    from services import storage_service

    class Refusing(FakeS3):
        def delete_objects(self, Bucket, Delete):
            return {"Errors": [{"Key": Delete["Objects"][0]["Key"], "Code": "AccessDenied", "Message": "no"}]}

    with pytest.raises(storage_service.StorageError, match="AccessDenied|no"):
        storage_service.delete_keys(Refusing({"a": b"1"}), ["a"])


# ── the routes ──────────────────────────────────────────────────────────────

@pytest.fixture
def api(observatory):
    app = FastAPI()
    for kind, collection in observatory.collections.items():
        app.include_router(make_doc_router(collection.doctype, collection, hub, viewer=lambda request, doc_id: None))
    seen = []
    app.include_router(make_observatory_router(
        observatory, hub, {}, image_viewer=lambda request, name: seen.append(name),
    ))
    app.dependency_overrides[require_auth] = lambda: {"email": "gm@example.com", "name": "GM"}
    with TestClient(app) as client:
        client.seen = seen
        yield client


def test_images_over_http(api):
    imported = api.post("/api/observatory/import", data={"path": "act 2"}, files={"files": ("map.png", PNG, "text/html")}).json()
    uploaded = imported["items"][0]
    served = api.get(uploaded["url"])
    assert served.status_code == 200 and served.content == PNG
    assert served.headers["content-type"] == "image/png"          # from its extension, not the uploader
    assert served.headers["x-content-type-options"] == "nosniff"
    assert api.seen == [uploaded["id"]]                             # the viewer rule was asked
    renamed = api.post("/api/observatory/images/rename", json={"id": uploaded["id"], "name": "cave.png"}).json()
    assert api.post("/api/observatory/images/move", json={"id": renamed["id"], "folder_path": ""}).json()["folder"] == ""
    assert api.get(uploaded["url"]).status_code == 200              # still found by its uid
    assert api.delete(f"/api/observatory/images/{renamed['id']}").json() == {"status": "success"}
    assert api.get(uploaded["url"]).status_code == 404
    refused = api.post("/api/observatory/import", files={"files": ("x.svg.html", b"<script>", "image/png")}).json()
    assert refused["items"] == [] and refused["skipped"][0]["path"] == "x.svg.html"


def test_folders_over_http(api):
    api.post("/api/charts", json={"name": "Tavern", "folder_path": "act 2"})
    assert api.post("/api/observatory/folders", json={"path": "act 3"}).json() == {"status": "success"}
    assert api.put("/api/observatory/folders/act 2", json={"name": "act II"}).status_code == 200
    assert api.post("/api/observatory/folders/move", json={"path": "act II", "dest_parent_path": "act 3"}).status_code == 200
    assert api.get("/api/charts/act 3/act II/tavern").json()["name"] == "Tavern"
    assert api.get("/api/observatory", params={"path": "act 3"}).json() == {"folders": ["act II"], "items": []}
    assert [i["folder"] for i in api.get("/api/observatory/all", params={"kind": "chart"}).json()["items"]] == ["act 3/act II"]
    assert api.get("/api/observatory/all", params={"kind": "song"}).status_code == 400
    assert [i["id"] for i in api.get("/api/observatory/search", params={"q": "tav"}).json()["items"]] == ["act 3/act II/tavern"]
    assert api.delete("/api/observatory/folders/act 3").status_code == 200
    assert api.delete("/api/observatory/folders/act 3").status_code == 404
    assert api.post("/api/observatory/folders", json={"path": "../x"}).status_code == 400


def test_export_and_import_over_http(api):
    api.post("/api/charts", json={"name": "Tavern", "folder_path": "act 2"})
    exported = api.get("/api/observatory/export")
    assert exported.status_code == 200 and exported.headers["content-type"] == "application/zip"
    assert 'filename="observatory.zip"' in exported.headers["content-disposition"]
    assert zipfile.ZipFile(io.BytesIO(exported.content)).namelist() == ["act 2/tavern.chart.json"]
    folder = api.get("/api/observatory/export", params={"path": "act 2"})
    assert "filename*=UTF-8''act%202.zip" in folder.headers["content-disposition"]
    assert zipfile.ZipFile(io.BytesIO(folder.content)).namelist() == ["tavern.chart.json"]

    imported = api.post("/api/observatory/import", data={"path": "act 3"}, files=[
        ("files", ("act 2.zip", folder.content, "application/zip")),
        ("files", ("cave.png", PNG, "image/png")),
    ]).json()
    assert sorted(i["kind"] for i in imported["items"]) == ["chart", "image"] and imported["skipped"] == []
    assert api.get("/api/charts/act 3/tavern").json()["name"] == "Tavern"


# ── the move of a bucket into the Observatory ───────────────────────────────

def test_the_migration_knows_every_kind():
    from services import doc_registry
    kinds = {c.doctype.prefix: c.doctype.kind for c in doc_registry.observatory.collections.values()}
    assert kinds == migration.DOC_PREFIXES


@pytest.mark.parametrize("key, target, rule", [
    ("charts/regions/tavern/chart.json", "observatory/regions/tavern.chart.json", "document"),
    ("characters/aria/character.json", "observatory/aria.character.json", "document"),
    ("adversaries/Sistemas/Bugboar/bugboar/adversary.json", "observatory/Sistemas/Bugboar/bugboar.adversary.json", "document"),
    ("encounters/act 2/.keep", "observatory/act 2/.keep", "folder"),
    ("charts/.imported-from-vault", "observatory/.charts-imported-from-vault", "marker"),
    ("adversaries/.imported-from-notes", "observatory/.imported-from-notes", "marker"),
    ("asset-library/Maps/1a2b3c4d-cave.png", "observatory/Maps/1a2b3c4d-cave.png", "image"),
    ("asset-library/top.png", f"observatory/{migration.image_filename('asset-library/top.png')}", "image"),
    ("asset-library/Maps/.keep", "observatory/Maps/.keep", "folder"),
    ("player/Combat/boss.mp3", None, "in-place"),
    ("observatory/x.chart.json", None, "in-place"),
    ("charts/tavern/map.png", None, "unknown"),
    ("stray.txt", None, "not-under-a-prefix"),
])
def test_where_each_key_goes(key, target, rule):
    assert migration.destination(key) == (target, rule)


def test_an_image_without_a_uid_gets_the_same_one_every_time():
    name = migration.image_filename("asset-library/Old/cave.png")
    assert image_uid(name) and name.endswith("-cave.png")
    assert migration.image_filename("asset-library/Old/cave.png") == name
    assert migration.image_filename("asset-library/Other/cave.png") != name


@pytest.mark.parametrize("text, expected", [
    ("![Ira](/api/asset-library/assets/asset-library/Campañas/Hijos%20Del%20Fango/f9b889ca-Ira.png)",
     "![Ira](/api/observatory/images/f9b889ca-Ira.png)"),
    ("![x](https://rk.example/api/asset-library/assets/asset-library/Maps/1a2b3c4d-Mapa%20(1).png) after",
     "![x](https://rk.example/api/observatory/images/1a2b3c4d-Mapa%20%281%29.png) after"),
    ("image: /api/asset-library/assets/asset-library/Bestiary/1a2b3c4d-bugboar.png\nname: x",
     "image: /api/observatory/images/1a2b3c4d-bugboar.png\nname: x"),
    ("no links here", "no links here"),
])
def test_image_links_are_rewritten(text, expected):
    assert migration.rewrite_links(text)[0] == expected


def test_a_document_s_link_may_hold_spaces():
    known = {"asset-library/Tierras Del Este/1a2b3c4d-cave map.png"}
    text = '{"image_url": "/api/asset-library/assets/asset-library/Tierras Del Este/1a2b3c4d-cave map.png"}'
    assert migration.rewrite_links(text, known) == ('{"image_url": "/api/observatory/images/1a2b3c4d-cave%20map.png"}', 1)
    source = "image: /api/asset-library/assets/asset-library/Tierras Del Este/1a2b3c4d-cave map.png\nname: x"
    assert migration.rewrite_links(source, known)[0] == "image: /api/observatory/images/1a2b3c4d-cave%20map.png\nname: x"


def test_a_link_to_an_image_moved_since_finds_it_by_its_uid():
    known = {"asset-library/Oneshots/Biblioteca/167b3479-fondo.png"}
    text = '"/api/asset-library/assets/asset-library/Biblioteca/167b3479-fondo.png"'
    assert migration.rewrite_links(text, known) == ('"/api/observatory/images/167b3479-fondo.png"', 1)


def test_a_link_to_an_image_that_is_gone_is_left_alone():
    missing = []
    text = "/api/asset-library/assets/asset-library/Maps/gone.png"
    assert migration.rewrite_links(text, known=set(), missing=missing) == (text, 0)
    assert missing == [text]


def _documents(objects):
    return {key: json.loads(value) for key, value in objects.items() if key.endswith(".json")}


def test_a_bucket_is_moved_into_the_observatory():
    old_map = "/api/asset-library/assets/asset-library/Maps/1a2b3c4d-cave.png"
    fake = FakeS3({
        "charts/act 2/tavern/chart.json": json.dumps({"id": "act 2/tavern", "name": "Tavern", "image_url": old_map}),
        "characters/aria/character.json": json.dumps({"id": "aria", "name": "Aria", "source": f"image: {old_map}\n"}),
        "charts/.imported-from-vault": "{}",
        "encounters/act 2/.keep": "",
        "asset-library/act 2/.keep": "",
        "asset-library/Maps/1a2b3c4d-cave.png": PNG,
        "asset-library/Old/cave.png": PNG,
        "player/Combat/boss.mp3": b"mp3",
    })
    plan = migration.build_plan(migration.list_objects(fake, "b"))
    assert not plan.conflicts and len(plan.moves) == 6 and len(plan.already_there) == 1   # the second act 2/.keep
    known = {key for key in fake.objects if key.startswith("asset-library/")}

    counts = migration.execute(fake, "b", plan, known, write=False, delete_sources=False, log=lambda line: None)
    assert counts["links"] == 2 and "observatory/act 2/tavern.chart.json" not in fake.objects   # a dry run

    counts = migration.execute(fake, "b", plan, known, write=True, delete_sources=True, log=lambda line: None)
    old_cave = migration.image_filename("asset-library/Old/cave.png")
    assert sorted(fake.objects) == sorted([
        "observatory/act 2/tavern.chart.json", "observatory/aria.character.json",
        "observatory/.charts-imported-from-vault", "observatory/act 2/.keep",
        "observatory/Maps/1a2b3c4d-cave.png", f"observatory/Old/{old_cave}", "player/Combat/boss.mp3",
    ])
    documents = _documents(fake.objects)
    assert documents["observatory/act 2/tavern.chart.json"]["image_url"] == "/api/observatory/images/1a2b3c4d-cave.png"
    assert documents["observatory/aria.character.json"]["source"] == "image: /api/observatory/images/1a2b3c4d-cave.png\n"
    assert migration.build_plan(migration.list_objects(fake, "b")).moves == []   # run again: nothing to do


def test_the_document_saved_last_stays():
    newer = json.dumps({"id": "a", "name": "Edited in the old app", "updated_at": "2026-10-06T10:00:00"})
    copied = json.dumps({"id": "a", "name": "Copied", "updated_at": "2026-10-06T09:00:00"})
    fake = FakeS3({
        "charts/a/chart.json": newer, "observatory/a.chart.json": copied,
        "charts/b/chart.json": copied, "observatory/b.chart.json": newer,
    })
    plan = migration.build_plan(migration.list_objects(fake, "b"))
    assert len(plan.compare) == 2 and not plan.conflicts
    counts = migration.execute(fake, "b", plan, set(), write=True, delete_sources=True, log=lambda line: None)
    assert (counts["refreshed"], counts["kept"]) == (1, 1)
    documents = _documents(fake.objects)
    assert documents["observatory/a.chart.json"]["name"] == "Edited in the old app"
    assert documents["observatory/b.chart.json"]["name"] == "Edited in the old app"
    assert sorted(fake.objects) == ["observatory/a.chart.json", "observatory/b.chart.json"]


def test_two_different_images_in_one_place_are_a_conflict():
    fake = FakeS3({"asset-library/1a2b3c4d-x.png": PNG, "observatory/1a2b3c4d-x.png": b"other"})
    assert len(migration.build_plan(migration.list_objects(fake, "b")).conflicts) == 1


def test_the_notes_are_rewritten(tmp_path):
    vault = tmp_path / "vault"
    (vault / "Campañas").mkdir(parents=True)
    (vault / ".obsidian").mkdir()
    note = vault / "Campañas" / "Fango.md"
    note.write_text("# Fango\n![Ira](/api/asset-library/assets/asset-library/Campañas/f9b889ca-Ira.png)\n", encoding="utf-8")
    (vault / ".obsidian" / "x.md").write_text("/api/asset-library/assets/asset-library/a.png", encoding="utf-8")
    lines = []
    args = type("Args", (), {"vault": str(vault), "apply": False})()
    migration.migrate_vault(args, log=lines.append)
    assert "asset-library" in note.read_text(encoding="utf-8")   # a dry run
    args.apply = True
    migration.migrate_vault(args, log=lines.append)
    assert note.read_text(encoding="utf-8") == "# Fango\n![Ira](/api/observatory/images/f9b889ca-Ira.png)\n"
    assert "asset-library" in (vault / ".obsidian" / "x.md").read_text(encoding="utf-8")
