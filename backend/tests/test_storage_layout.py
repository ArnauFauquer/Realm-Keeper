"""How the bucket is laid out — player/, asset-library/, and one prefix per kind
of document — and the one-time script that moves an old bucket there. Run from
backend/:  python -m pytest tests/test_storage_layout.py
"""
import io
import json

import pytest

from config.settings import settings
from scripts import migrate_storage_layout as migrate
from services import storage_service
from services.doc_backend import S3DocBackend
from services.doc_collection import DocCollection
from services.doc_registry import BATTLEMAP, CHARACTERS, CHART, ENCOUNTER, VISTA

from conftest import FakeS3

ALL_KINDS = (CHART, VISTA, ENCOUNTER, BATTLEMAP, CHARACTERS)
LIB = "/api/asset-library/assets/asset-library/"


# ── the player ──────────────────────────────────────────────────────────────

def upload(album, name, body=b"audio"):
    return storage_service.upload_track(album, name, io.BytesIO(body), "audio/mpeg")


def test_audio_is_stored_under_player_and_keyed_by_album_and_file(fake_s3):
    storage_service.create_album("Action")
    assert upload("Action", "theme.mp3") == {"key": "Action/theme.mp3", "name": "theme.mp3"}
    assert sorted(fake_s3.objects) == ["player/Action/.keep", "player/Action/theme.mp3"]
    assert fake_s3.content_types["player/Action/theme.mp3"] == "audio/mpeg"
    assert [(t["key"], t["name"]) for t in storage_service.list_tracks("Action")] == [("Action/theme.mp3", "theme.mp3")]
    assert storage_service.get_track_stream("Action/theme.mp3")["Body"].read() == b"audio"


def test_an_album_may_be_called_like_anything_else_in_the_bucket(fake_s3):
    # Albums used to share the top level with everything, so some names were off limits.
    collection = DocCollection(CHART, S3DocBackend())
    collection.create("Tavern")
    for name in ("charts", "docs", "asset-library", "vistas", "player"):
        storage_service.create_album(name)
    assert storage_service.list_albums() == ["asset-library", "charts", "docs", "player", "vistas"]
    upload("charts", "map.mp3")
    assert [m.id for m in collection.list_all()] == ["tavern"]          # the documents did not notice
    assert [t["key"] for t in storage_service.list_tracks("charts")] == ["charts/map.mp3"]


def test_the_albums_are_what_is_under_player_and_nothing_else(fake_s3):
    fake_s3.objects.update({
        "asset-library/Maps/1a2b3c4d-cave.png": b"x", "charts/tavern/chart.json": b"{}",
        "player/Ambient/.keep": b"", "player/Combat/boss.mp3": b"x",
    })
    assert storage_service.list_albums() == ["Ambient", "Combat"]


def test_tracks_are_renamed_moved_and_deleted_inside_player(fake_s3):
    for album in ("A", "B"):
        storage_service.create_album(album)
    upload("A", "one.mp3")
    assert storage_service.rename_track("A/one.mp3", "two.mp3") == {"key": "A/two.mp3", "name": "two.mp3"}
    assert storage_service.move_track("A/two.mp3", "B") == {"key": "B/two.mp3"}
    assert "player/B/two.mp3" in fake_s3.objects and "player/A/one.mp3" not in fake_s3.objects
    storage_service.delete_track("B/two.mp3")
    assert not any(key.endswith(".mp3") for key in fake_s3.objects)


def test_albums_are_renamed_and_deleted_whole(fake_s3):
    storage_service.create_album("Old")
    upload("Old", "a.mp3")
    storage_service.create_album("Other")
    storage_service.rename_album("Old", "New")
    assert sorted(fake_s3.objects) == ["player/New/.keep", "player/New/a.mp3", "player/Other/.keep"]
    with pytest.raises(storage_service.StorageError, match="already exists"):
        storage_service.rename_album("New", "Other")
    with pytest.raises(storage_service.StorageError, match="not found"):
        storage_service.rename_album("Nothing", "Else")
    storage_service.delete_album("New")
    assert list(fake_s3.objects) == ["player/Other/.keep"]


def test_the_asset_library_keeps_its_prefix(fake_s3):
    saved = storage_service.upload_library_asset("Maps", "cave.png", io.BytesIO(b"png"), "image/png")
    assert saved["key"].startswith("asset-library/Maps/") and saved["key"].endswith("-cave.png")


# ── the documents ───────────────────────────────────────────────────────────

def test_each_kind_of_document_has_its_own_top_level_prefix(fake_s3):
    backend = S3DocBackend()
    for doctype in ALL_KINDS:
        collection = DocCollection(doctype, backend)
        if doctype.singleton:
            collection.write_raw(doctype.singleton, {"id": doctype.singleton})
        else:
            collection.create("Thing", folder_path="folder")
    keys = sorted(fake_s3.objects)
    assert keys == [
        "battlemaps/folder/thing/battlemap.json",
        "characters/all/characters.json",
        "charts/folder/thing/chart.json",
        "encounters/folder/thing/encounter.json",
        "vistas/folder/thing/vista.json",
    ]


# ── the migration: what goes where ──────────────────────────────────────────

@pytest.mark.parametrize("key, target, rule", [
    ("Action/theme.mp3", "player/Action/theme.mp3", "album"),
    ("Ambient/.keep", "player/Ambient/.keep", "album"),
    ("docs/charts/regions/tavern/chart.json", "charts/regions/tavern/chart.json", "document"),
    ("docs/vistas/La Biblioteca/la-entrada/vista.json", "vistas/La Biblioteca/la-entrada/vista.json", "document"),
    ("docs/encounters/fight/encounter.json", "encounters/fight/encounter.json", "document"),
    ("docs/characters/all/characters.json", "characters/all/characters.json", "document"),
    ("docs/charts/empty/.keep", "charts/empty/.keep", "document"),
    ("docs/.imported/charts", "charts/.imported-from-vault", "document-marker"),
    ("charts/hola/map/Wei.jpg", "asset-library/Legacy/charts/hola/map/Wei.jpg", "legacy-image"),
    ("vistas/tavern/background/bg.png", "asset-library/Legacy/vistas/tavern/background/bg.png", "legacy-image"),
    # Never reserved, so these could have been albums:
    ("encounters/theme.mp3", "player/encounters/theme.mp3", "album"),
    ("characters/.keep", "player/characters/.keep", "album"),
    ("player/theme.mp3", "player/player/theme.mp3", "album"),
    ("player/.keep", "player/player/.keep", "album"),
])
def test_where_a_key_goes(key, target, rule):
    assert migrate.destination(key) == (target, rule)


@pytest.mark.parametrize("key, why", [
    ("player/Action/theme.mp3", "in-place"),
    ("asset-library/Maps/1a2b3c4d-cave.png", "in-place"),
    ("asset-library/Legacy/vistas/x/bg.png", "in-place"),
    ("charts/regions/tavern/chart.json", "in-place"),
    ("charts/empty/.keep", "in-place"),
    ("charts/.imported-from-vault", "in-place"),
    ("vistas/night/vista.json", "in-place"),
    ("characters/all/characters.json", "in-place"),
    ("stray.txt", "not-under-a-prefix"),
    ("docs/mystery/x.json", "unknown-under-docs"),
    ("docs/charts", "unknown-under-docs"),
    ("docs/.imported/mystery", "unknown-under-docs"),
])
def test_what_stays_and_what_cannot_be_placed(key, why):
    assert migrate.destination(key) == (None, why)


def test_the_script_knows_the_kinds_the_app_declares():
    assert migrate.DOC_KINDS == {doctype.prefix: doctype.item_filename for doctype in ALL_KINDS}


# ── the migration: a whole bucket ───────────────────────────────────────────

OLD_VISTA = json.dumps({
    "id": "pazadizos", "name": "Pazadizos",
    "background_url": "/api/vistas/assets/vistas/pazadizos/background/c7a02a2c-fondo.jpg",
    "assets": [{"id": "a", "name": "Orc", "image_url": f"{LIB}Oneshots/orc.png"}],
})
OLD_CHART = json.dumps({
    "id": "wei", "name": "Wei", "image_url": f"{LIB}Wei/19f420c6-Wei-Spring.jpg",
    "pins": [{"id": "p", "x": 1, "y": 2, "name": "Gate", "icon_url": "/api/charts/assets/charts/wei/pins/p/Gate.png"}],
})


def old_bucket():
    return FakeS3({
        "Action/.keep": b"",
        "Action/01 Beyond Distant Lands.mp3": b"a" * 40,
        "Action/it's (live) & more.mp3": b"b" * 20,
        "Ambient/.keep": b"",
        "encounters/rain.mp3": b"c" * 10,                       # an album that happens to be called "encounters"
        "asset-library/Maps/1a2b3c4d-cave.png": b"png",
        "asset-library/Oneshots/orc.png": b"png",
        "charts/wei/map/Wei-Spring.jpg": b"j" * 7,              # from before the asset library
        "charts/wei/pins/p/Gate.png": b"g" * 5,
        "vistas/pazadizos/background/c7a02a2c-fondo.jpg": b"f" * 9,
        "docs/.imported/charts": b'{"documents": 1}',
        "docs/.imported/vistas": b'{"documents": 1}',
        "docs/charts/wei/chart.json": OLD_CHART,
        "docs/charts/empty/.keep": b"",
        "docs/vistas/La Biblioteca/pazadizos/vista.json": OLD_VISTA,
        "docs/encounters/fight/encounter.json": b'{"id": "fight", "name": "Fight"}',
        "docs/battlemaps/cave/battlemap.json": b'{"id": "cave", "name": "Cave"}',
        "docs/characters/all/characters.json": b'{"id": "all", "name": "Characters"}',
    })


NEW_KEYS = sorted([
    "player/Action/.keep", "player/Action/01 Beyond Distant Lands.mp3", "player/Action/it's (live) & more.mp3",
    "player/Ambient/.keep", "player/encounters/rain.mp3",
    "asset-library/Maps/1a2b3c4d-cave.png", "asset-library/Oneshots/orc.png",
    "asset-library/Legacy/charts/wei/map/Wei-Spring.jpg", "asset-library/Legacy/charts/wei/pins/p/Gate.png",
    "asset-library/Legacy/vistas/pazadizos/background/c7a02a2c-fondo.jpg",
    "charts/.imported-from-vault", "vistas/.imported-from-vault",
    "charts/wei/chart.json", "charts/empty/.keep",
    "vistas/La Biblioteca/pazadizos/vista.json",
    "encounters/fight/encounter.json", "battlemaps/cave/battlemap.json", "characters/all/characters.json",
])


def migrate_all(fake, **kwargs):
    plan = migrate.build_plan(migrate.list_objects(fake, "bucket"))
    migrate.execute(fake, "bucket", plan, log=lambda *_: None, **kwargs)
    return plan


def test_an_old_bucket_ends_up_in_the_new_layout():
    fake = old_bucket()
    plan = migrate_all(fake, delete_sources=True)
    assert not plan.conflicts and not plan.unplaced
    assert sorted(fake.objects) == NEW_KEYS


def test_nothing_is_lost_or_changed_on_the_way():
    fake = old_bucket()
    before = dict(fake.objects)
    migrate_all(fake, delete_sources=True)
    assert fake.objects["player/Action/01 Beyond Distant Lands.mp3"] == before["Action/01 Beyond Distant Lands.mp3"]
    assert fake.objects["charts/wei/chart.json"] == before["docs/charts/wei/chart.json"]
    assert fake.objects["asset-library/Legacy/charts/wei/pins/p/Gate.png"] == before["charts/wei/pins/p/Gate.png"]
    assert sorted(fake.objects.values()) == sorted(before.values())    # the same objects, in other places


def test_running_it_again_has_nothing_to_do():
    fake = old_bucket()
    migrate_all(fake, delete_sources=True)
    again = migrate.build_plan(migrate.list_objects(fake, "bucket"))
    assert not (again.moves or again.already_there or again.conflicts or again.unplaced)
    assert again.in_place == len(NEW_KEYS)


def test_copy_only_leaves_the_old_keys_and_a_later_apply_removes_them():
    fake = old_bucket()
    old = set(fake.objects)
    migrate_all(fake, delete_sources=False)
    assert old <= set(fake.objects) and set(NEW_KEYS) <= set(fake.objects)

    plan = migrate_all(fake, delete_sources=True)                      # the second run
    assert not plan.moves and len(plan.already_there) == len(old - set(NEW_KEYS))
    assert sorted(fake.objects) == NEW_KEYS


def test_a_run_that_stopped_halfway_is_finished_by_the_next():
    fake = old_bucket()
    calls = []
    real = fake.copy_object

    def dies_on_the_fifth(**kwargs):
        calls.append(kwargs["Key"])
        if len(calls) == 5:
            raise OSError("the connection dropped")
        real(**kwargs)

    fake.copy_object = dies_on_the_fifth
    with pytest.raises(OSError):
        migrate_all(fake, delete_sources=True)
    fake.copy_object = real
    assert any(not key.startswith(("player/", "asset-library/", "charts/", "vistas/", "encounters/", "battlemaps/", "characters/"))
               for key in fake.objects)                                # not finished
    migrate_all(fake, delete_sources=True)
    assert sorted(fake.objects) == NEW_KEYS


def test_a_copy_that_does_not_match_is_never_followed_by_a_delete():
    fake = old_bucket()
    real = fake.copy_object

    def truncating(**kwargs):
        real(**kwargs)
        fake.objects[kwargs["Key"]] = fake.objects[kwargs["Key"]][:-1]

    fake.copy_object = truncating
    with pytest.raises(RuntimeError, match="bytes"):
        migrate_all(fake, delete_sources=True)
    assert "Action/.keep" in fake.objects or "Action/01 Beyond Distant Lands.mp3" in fake.objects


def test_a_target_that_exists_and_differs_stops_everything_until_someone_looks():
    fake = old_bucket()
    fake.objects["charts/wei/chart.json"] = b'{"id": "wei", "name": "Edited in the new app"}'
    plan = migrate.build_plan(migrate.list_objects(fake, "bucket"))
    assert [(m.source, why.split(" ")[0]) for m, why in plan.conflicts] == [("docs/charts/wei/chart.json", "charts/wei/chart.json")]
    assert "CONFLICT" in migrate.describe(plan)


def test_two_keys_that_want_the_same_place_are_a_conflict_not_an_overwrite():
    plan = migrate.build_plan([
        migrate.Stored("player/x.mp3", 3, "a"),          # an album called "player"
        migrate.Stored("x.mp3/y", 3, "b"),
        migrate.Stored("player/player/x.mp3", 3, "c"),
    ])
    assert len(plan.conflicts) == 1


def test_a_copy_made_earlier_is_recognized_by_its_content():
    same = migrate.build_plan([
        migrate.Stored("Action/a.mp3", 5, "etag"), migrate.Stored("player/Action/a.mp3", 5, "etag"),
    ])
    assert len(same.already_there) == 1 and not same.moves
    other = migrate.build_plan([
        migrate.Stored("Action/a.mp3", 5, "one"), migrate.Stored("player/Action/a.mp3", 5, "two"),
    ])
    assert len(other.conflicts) == 1
    # Uploaded in parts, an ETag says nothing about the content: the size has to do.
    parts = migrate.build_plan([
        migrate.Stored("Action/big.mp3", 50, "abc-3"), migrate.Stored("player/Action/big.mp3", 50, "def"),
    ])
    assert len(parts.already_there) == 1


def test_what_cannot_be_placed_is_left_alone_and_said_so():
    fake = FakeS3({"stray.txt": b"x", "docs/mystery/x.json": b"{}", "Action/a.mp3": b"x"})
    plan = migrate_all(fake, delete_sources=True)
    assert sorted(key for key, _ in plan.unplaced) == ["docs/mystery/x.json", "stray.txt"]
    assert sorted(fake.objects) == ["docs/mystery/x.json", "player/Action/a.mp3", "stray.txt"]


# ── the migration: the documents that named an old image ────────────────────

def test_documents_are_pointed_at_the_images_where_they_now_are():
    fake = old_bucket()
    migrate_all(fake, delete_sources=True)
    assert migrate.rewrite_documents(fake, "bucket", apply=True, log=lambda *_: None) == 2

    vista = json.loads(fake.objects["vistas/La Biblioteca/pazadizos/vista.json"])
    assert vista["background_url"] == f"{LIB}Legacy/vistas/pazadizos/background/c7a02a2c-fondo.jpg"
    assert vista["assets"][0]["image_url"] == f"{LIB}Oneshots/orc.png"           # the rest is as it was
    chart = json.loads(fake.objects["charts/wei/chart.json"])
    assert chart["pins"][0]["icon_url"] == f"{LIB}Legacy/charts/wei/pins/p/Gate.png"
    assert chart["image_url"] == f"{LIB}Wei/19f420c6-Wei-Spring.jpg"
    # and what they point at is there
    for url in (vista["background_url"], chart["pins"][0]["icon_url"]):
        assert url[len("/api/asset-library/assets/"):] in fake.objects
    assert migrate.rewrite_documents(fake, "bucket", apply=True, log=lambda *_: None) == 0   # nothing left to do


def test_a_reference_to_an_image_that_is_not_in_the_bucket_is_reported_and_left(capsys):
    fake = old_bucket()
    lost = "/api/vistas/assets/vistas/gone/background/lost.jpg"
    fake.objects["docs/vistas/gone/vista.json"] = json.dumps({"id": "gone", "name": "Gone", "background_url": lost}).encode()
    migrate_all(fake, delete_sources=True)
    messages = []
    assert migrate.rewrite_documents(fake, "bucket", apply=True, log=messages.append) == 2     # not this one
    assert json.loads(fake.objects["vistas/gone/vista.json"])["background_url"] == lost
    assert any("lost.jpg is not in the bucket" in message for message in messages)


def test_names_with_spaces_and_accents_are_followed_wherever_the_url_spells_them():
    fake = FakeS3({
        "charts/hola/pins/p/Puertas De Obsidiana.png": b"x",
        "charts/hola/map/Campaña.jpg": b"y",
        "docs/charts/hola/chart.json": json.dumps({
            "id": "hola", "name": "Hola",
            "pins": [{"id": "p", "x": 1, "y": 1, "name": "p", "icon_url": "/api/charts/assets/charts/hola/pins/p/Puertas%20De%20Obsidiana.png"}],
            "image_url": "/api/charts/assets/charts/hola/map/Campaña.jpg",
        }).encode(),
    })
    migrate_all(fake, delete_sources=True)
    assert migrate.rewrite_documents(fake, "bucket", apply=True, log=lambda *_: None) == 1
    chart = json.loads(fake.objects["charts/hola/chart.json"])
    assert chart["pins"][0]["icon_url"] == f"{LIB}Legacy/charts/hola/pins/p/Puertas%20De%20Obsidiana.png"
    assert chart["image_url"] == f"{LIB}Legacy/charts/hola/map/Campaña.jpg"
    assert "asset-library/Legacy/charts/hola/pins/p/Puertas De Obsidiana.png" in fake.objects


def test_only_the_old_scheme_is_touched():
    untouched = {"a": f"{LIB}Maps/x.png", "b": "https://example.org/api/vistas/assets/vistas/x", "c": "note /api/vistas/assets/vistas/x"}
    assert migrate._point_at_the_library(untouched, set(), []) == (untouched, 0)


def test_a_dry_run_changes_nothing_and_still_finds_the_documents_not_yet_moved():
    fake = old_bucket()
    before = dict(fake.objects)
    assert migrate.rewrite_documents(fake, "bucket", apply=False, log=lambda *_: None) == 2
    assert fake.objects == before


def test_an_old_document_can_be_saved_again_once_pointed_at_the_library(monkeypatch):
    """The vista named its background by a URL nothing serves, so saving it was refused."""
    fake = old_bucket()
    migrate_all(fake, delete_sources=True)
    migrate.rewrite_documents(fake, "bucket", apply=True, log=lambda *_: None)
    monkeypatch.setattr(storage_service, "_client", lambda: fake)
    vistas = DocCollection(VISTA, S3DocBackend())
    vista = vistas.get("La Biblioteca/pazadizos")
    saved = vistas.save("La Biblioteca/pazadizos", {"name": "Pazadizos", "assets": [a.model_dump() for a in vista.assets]})
    assert saved.background_url.startswith(LIB + "Legacy/")


# ── the command ─────────────────────────────────────────────────────────────

@pytest.fixture
def command(monkeypatch):
    fake = old_bucket()
    monkeypatch.setattr(storage_service, "_client", lambda: fake)
    monkeypatch.setattr(settings, "S3_ENDPOINT_URL", "http://minio:9000")
    monkeypatch.setattr(settings, "S3_BUCKET_NAME", "bucket")
    return fake


def test_by_default_it_only_says_what_it_would_do(command, capsys):
    before = dict(command.objects)
    assert migrate.main([]) == 0
    out = capsys.readouterr().out
    assert "dry run" in out and "audio into player/" in out and "2 document(s)" in out
    assert command.objects == before


def test_it_asks_before_changing_anything(command, monkeypatch, capsys):
    before = dict(command.objects)
    monkeypatch.setattr("builtins.input", lambda prompt: "n")
    assert migrate.main(["--apply"]) == 1
    assert command.objects == before and "Nothing changed" in capsys.readouterr().out


def test_apply_moves_everything_and_rewrites_the_documents(command, capsys):
    assert migrate.main(["--apply", "--yes"]) == 0
    assert sorted(command.objects) == NEW_KEYS
    assert "Pointed 2 document(s)" in capsys.readouterr().out


def test_copy_only_copies_and_rewrites_nothing(command, capsys):
    assert migrate.main(["--copy-only", "--yes"]) == 0
    assert "Action/01 Beyond Distant Lands.mp3" in command.objects
    assert "player/Action/01 Beyond Distant Lands.mp3" in command.objects
    assert b"/api/vistas/assets/" in command.objects["vistas/La Biblioteca/pazadizos/vista.json"]


def test_a_conflict_stops_it_before_anything_is_touched(command, capsys):
    command.objects["charts/wei/chart.json"] = b"{}"
    before = dict(command.objects)
    assert migrate.main(["--apply", "--yes"]) == 1
    assert command.objects == before and "CONFLICT" in capsys.readouterr().out


def test_without_an_endpoint_there_is_no_bucket(monkeypatch, capsys):
    monkeypatch.setattr(settings, "S3_ENDPOINT_URL", "")
    assert migrate.main(["--apply", "--yes"]) == 2
