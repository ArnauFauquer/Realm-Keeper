"""The generic document layer: backends, collections, commands, the live hub and
its routes. Run from backend/:  python -m pytest tests/test_docs.py
"""
import asyncio
import io
import json
import time
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from models.characters import Character
from models.sheet_doc import SheetDocMetadata
from models.encounter import Encounter, EncounterMetadata
from routes import sync as sync_routes
from routes.auth import require_auth
from routes.doc_router import make_doc_router
from routes.observatory import make_observatory_router
from services import doc_commands, sync_hub
from services.doc_backend import DocBackendError, LocalDocBackend
from services.doc_collection import DocCollection, DocNotFound
from services.doc_type import DocType
from services.observatory import Observatory
from services.sheet_docs import sheet_preparer
from services.sync_hub import DocHub, diff_docs

ENCOUNTER = DocType(
    kind="encounter", prefix="encounters",
    model=Encounter, metadata_model=EncounterMetadata, items_key="encounters",
    image_fields=("combatants[].image_url",),
    live=True, collections=("combatants",), patchable=("name", "description"),
)
CHARACTER = DocType(
    kind="character", prefix="characters",
    model=Character, metadata_model=SheetDocMetadata, items_key="characters",
    live=True, patchable=("name", "description", "source"), resources_field="resources",
    prepare=sheet_preparer("character"),
)
ARIA_SHEET = "sections:\n  - counters:\n      HP: 12\n      Hope: { max: 6, start: 2 }\n"
LIBRARY_IMAGE = "/api/observatory/images/1a2b3c4d-orc.png"


# ── backends ────────────────────────────────────────────────────────────────

def test_backend_round_trip(backend):
    assert backend.get("docs/a/x.json") is None
    assert not backend.exists("docs/a/x.json")
    backend.put("docs/a/x.json", '{"n": "ñ"}')
    assert backend.get("docs/a/x.json") == '{"n": "ñ"}'
    assert backend.exists("docs/a/x.json")
    backend.put("docs/a/x.json", "second")
    assert backend.get("docs/a/x.json") == "second"


def test_backend_lists_everything_under_a_prefix(backend):
    for key in ("docs/a/one/d.json", "docs/a/two/deep/d.json", "docs/b/other.json"):
        backend.put(key, "x")
    assert backend.list_keys("docs/a/") == ["docs/a/one/d.json", "docs/a/two/deep/d.json"]
    assert backend.list_keys("docs/none/") == []


def test_backend_deletes_a_prefix_and_only_that(backend):
    backend.put("docs/a/one/d.json", "x")
    backend.put("docs/a/one/more.json", "x")
    backend.put("docs/a/two/d.json", "x")
    backend.delete_prefix("docs/a/one/")
    assert backend.list_keys("docs/a/") == ["docs/a/two/d.json"]
    backend.delete_prefix("docs/a/missing/")


def test_backend_moves_a_prefix(backend):
    backend.put("docs/a/one/d.json", "x")
    backend.put("docs/a/one/sub/e.json", "y")
    backend.move_prefix("docs/a/one/", "docs/a/moved/one/")
    assert backend.list_keys("docs/a/") == ["docs/a/moved/one/d.json", "docs/a/moved/one/sub/e.json"]
    assert backend.get("docs/a/moved/one/sub/e.json") == "y"


def test_backend_keeps_files_moves_and_deletes_them(backend):
    backend.put_file("docs/a/map.png", io.BytesIO(b"PNG!" * 40000), "image/png")
    chunks, length = backend.open("docs/a/map.png")
    assert (b"".join(chunks), length) == (b"PNG!" * 40000, 160000)
    assert backend.open("docs/a/none.png") is None
    backend.move("docs/a/map.png", "docs/b/map.png")
    assert not backend.exists("docs/a/map.png") and backend.exists("docs/b/map.png")
    backend.put("docs/b/other.png", "x")
    with pytest.raises(DocBackendError):
        backend.move("docs/b/map.png", "docs/b/other.png")
    with pytest.raises(DocBackendError):
        backend.move("docs/a/map.png", "docs/c/map.png")
    backend.delete("docs/b/map.png")
    backend.delete("docs/b/map.png")   # nothing there: no error
    assert backend.list_keys("docs/") == ["docs/b/other.png"]


def test_backend_refuses_a_move_that_cannot_happen(backend):
    backend.put("docs/a/one/d.json", "x")
    backend.put("docs/a/two/d.json", "x")
    with pytest.raises(DocBackendError):
        backend.move_prefix("docs/a/missing/", "docs/a/new/")
    with pytest.raises(DocBackendError):
        backend.move_prefix("docs/a/one/", "docs/a/two/")


@pytest.mark.parametrize("key", ["", "docs/../x", "docs//x", "/abs", "docs/\\x"])
def test_backend_rejects_unsafe_keys(backend, key):
    with pytest.raises(ValueError):
        backend.get(key)


# ── collection ──────────────────────────────────────────────────────────────

@pytest.fixture
def collection(tmp_path):
    return DocCollection(ENCOUNTER, LocalDocBackend(tmp_path))


def test_create_names_a_document_by_its_slug_and_keeps_it_unique(collection):
    first = collection.create("Cave Ambush")
    second = collection.create("Cave Ambush")
    assert (first.id, second.id) == ("cave-ambush", "cave-ambush-2")
    assert collection.get("cave-ambush").name == "Cave Ambush"
    assert collection.get("nothing") is None


def test_a_slug_keeps_the_letters_of_an_accented_name(collection):
    assert collection.create("Ciénaga del Jabalí").id == "cienaga-del-jabali"
    assert collection.create("龍の巣").id == "encounter"   # nothing to keep: the kind's name


def test_documents_made_at_once_with_one_name_get_different_slugs(collection):
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=8) as pool:
        ids = list(pool.map(lambda _: collection.create("Ambush").id, range(8)))
    assert len(set(ids)) == 8


def test_a_document_cannot_be_in_a_folder_named_like_one_of_its_lists(collection):
    # "a/combatants/b" would read as combatant "b" of encounter "a".
    with pytest.raises(ValueError, match="folder named 'combatants'"):
        collection.create("B", folder_path="a/combatants")
    collection.create("B", folder_path="a")
    with pytest.raises(ValueError, match="folder named 'combatants'"):
        collection.move_item("a/b", "a/combatants")


def test_a_damaged_document_can_still_be_deleted(collection, tmp_path):
    collection.create("Broken")
    collection.backend.put(collection.key("broken"), "{not json")
    collection.create("Odd")
    collection.backend.put(collection.key("odd"), "[1, 2]")
    with pytest.raises(ValueError):
        collection.read_raw("odd")      # not a TypeError: a 400, not a 500
    collection.move_item("broken", "attic")
    collection.delete("attic/broken")
    collection.delete("odd")
    assert collection.list_all() == []


def test_names_too_long_for_the_store_are_refused(collection):
    with pytest.raises(ValueError, match="too long"):
        collection.create("x" * 300)    # its slug, as a key
    with pytest.raises(ValueError, match="too long"):
        collection.create("Fine", folder_path="/".join(["deep"] * 200))


def test_create_needs_a_name_and_never_names_a_document_like_a_route(collection):
    with pytest.raises(ValueError):
        collection.create("   ")
    # Called what a route is called, a document gets another slug rather than being refused.
    assert [collection.create(name).id for name in ("Combatants", "Folders", "Order")] == [
        "combatants-2", "folders-2", "order-2",
    ]


def test_a_document_is_one_file_in_the_observatory_tree(collection, tmp_path):
    collection.create("Zed")
    collection.create("Inside", folder_path="goblins")
    collection.create("Deeper", folder_path="goblins/caves")
    files = sorted(p.relative_to(tmp_path).as_posix() for p in tmp_path.rglob("*") if p.is_file())
    assert files == [
        "observatory/goblins/caves/deeper.encounter.json",
        "observatory/goblins/inside.encounter.json",
        "observatory/zed.encounter.json",
    ]
    # What else is in the tree (another kind, an image, a marker) is not one of its documents.
    (tmp_path / "observatory" / "zed.chart.json").write_text("{}")
    (tmp_path / "observatory" / "1a2b3c4d-zed.png").write_text("x")
    (tmp_path / "observatory" / ".encounters-imported-from-vault").write_text("{}")
    assert [m.id for m in collection.list_all()] == ["goblins/caves/deeper", "goblins/inside", "zed"]


def test_an_imported_document_is_added_beside_what_is_there(collection):
    data = {"id": "elsewhere/stale", "name": "Old fight", "combatants": [{"id": "o", "name": "Orc"}]}
    assert collection.add("goblins", "old-fight", data).id == "goblins/old-fight"
    assert collection.read_raw("goblins/old-fight")["combatants"][0]["name"] == "Orc"
    again = collection.add("goblins", "old-fight", {**data, "name": "Other"})
    assert (again.id, again.name) == ("goblins/old-fight-2", "Other")
    assert collection.read_raw("goblins/old-fight")["name"] == "Old fight"
    assert collection.add("", "Sin Nombre", {}).name == "sin-nombre"
    with pytest.raises(ValueError):
        collection.add("", "x", {"name": "X", "combatants": [{"id": "o", "name": "1"}, {"id": "o", "name": "2"}]})


def test_rename_and_delete(collection):
    collection.create("Old")
    assert collection.rename("old", "New name").name == "New name"
    assert collection.get("old").name == "New name"
    collection.delete("old")
    assert collection.get("old") is None
    with pytest.raises(DocNotFound):
        collection.delete("old")
    with pytest.raises(DocNotFound):
        collection.rename("old", "x")


def test_save_replaces_the_fields_but_keeps_the_id_and_locked_ones(tmp_path):
    locked = DocType(**{**ENCOUNTER.__dict__, "locked_fields": ("description",)})
    collection = DocCollection(locked, LocalDocBackend(tmp_path))
    collection.create("A", description="keep me")
    saved = collection.save("a", {"name": "B", "description": "ignored", "id": "other"})
    assert (saved.id, saved.name, saved.description) == ("a", "B", "keep me")


def test_images_must_come_from_the_observatory(collection):
    collection.create("A")
    ok = {"name": "A", "combatants": [{"id": "c1", "name": "Orc", "image_url": LIBRARY_IMAGE}]}
    assert collection.save("a", ok).combatants[0].image_url == LIBRARY_IMAGE
    bad = {"name": "A", "combatants": [{"id": "c1", "name": "Orc", "image_url": "https://evil.example/x.png"}]}
    with pytest.raises(ValueError, match="Observatory"):
        collection.save("a", bad)


def test_an_invalid_document_is_refused_with_the_reason(collection):
    collection.create("A")
    with pytest.raises(ValueError, match="unique"):
        collection.save("a", {"name": "A", "combatants": [{"id": "x", "name": "1"}, {"id": "x", "name": "2"}]})


def test_moving_a_document_keeps_its_slug(collection):
    collection.create("Orcs")
    assert collection.move_item("orcs", "goblins/caves") == "goblins/caves/orcs"
    assert collection.get("orcs") is None
    assert collection.get("goblins/caves/orcs").name == "Orcs"
    assert collection.move_item("goblins/caves/orcs", "goblins/caves") == "goblins/caves/orcs"
    collection.create("Orcs")
    with pytest.raises(ValueError):
        collection.move_item("orcs", "goblins/caves")


# ── events and commands ─────────────────────────────────────────────────────

def test_diff_reports_nothing_when_nothing_changed():
    doc = {"id": "a", "name": "A", "rev": 1, "updated_at": "x", "combatants": [{"id": "1", "name": "n"}]}
    assert diff_docs(doc, {**doc, "rev": 9, "updated_at": "y"}) is None


def test_diff_reports_fields_and_entities():
    old = {"name": "A", "count": 0, "combatants": [{"id": "1", "n": 1}, {"id": "2", "n": 2}, {"id": "3", "n": 3}]}
    new = {"name": "A", "count": 1, "combatants": [{"id": "3", "n": 3}, {"id": "1", "n": 10}, {"id": "4", "n": 4}]}
    assert diff_docs(old, new) == {
        "set": {"count": 1},
        "upsert": {"combatants": [{"id": "1", "n": 10}, {"id": "4", "n": 4}]},
        "remove": {"combatants": ["2"]},
        "order": {"combatants": ["3", "1", "4"]},
    }


def test_diff_matches_the_shared_cases():
    # frontend/tests/applyEvent.test.js applies these events and expects `new`.
    cases = json.loads((Path(__file__).parent / "fixtures" / "events.json").read_text(encoding="utf-8"))
    assert len(cases) > 3
    for case in cases:
        assert diff_docs(case["old"], case["new"]) == case["event"], case["name"]


def test_diff_leaves_the_order_out_when_it_did_not_change():
    old = {"combatants": [{"id": "1", "n": 1}, {"id": "2", "n": 2}]}
    new = {"combatants": [{"id": "1", "n": 5}, {"id": "2", "n": 2}]}
    assert diff_docs(old, new) == {"upsert": {"combatants": [{"id": "1", "n": 5}]}}


def _doc():
    return {"combatants": [
        {"id": "a", "name": "A", "resources": {"HP": {"current": 5, "max": 6, "min": 0}}},
        {"id": "b", "name": "B"},
    ]}


def test_add_items_gives_ids_and_refuses_duplicates_unless_told_to_ignore_them():
    doc = _doc()
    doc_commands.add_items(doc, ENCOUNTER, "combatants", [{"name": "C"}, {"id": "a", "name": "again"}], ignore_existing=True)
    assert len(doc["combatants"]) == 3 and len(doc["combatants"][2]["id"]) == 8
    with pytest.raises(ValueError, match="exists"):
        doc_commands.add_items(doc, ENCOUNTER, "combatants", [{"id": "a", "name": "again"}])
    with pytest.raises(ValueError, match="collection"):
        doc_commands.add_items(doc, ENCOUNTER, "nothing", [{}])


def test_patch_merges_nested_values_and_cannot_rename_an_id():
    doc = _doc()
    doc_commands.patch_item(doc, ENCOUNTER, "combatants", "a", {"resources": {"HP": {"current": 1}}, "notes": "hi"})
    assert doc["combatants"][0]["resources"]["HP"] == {"current": 1, "max": 6, "min": 0}
    assert doc["combatants"][0]["notes"] == "hi"
    with pytest.raises(ValueError):
        doc_commands.patch_item(doc, ENCOUNTER, "combatants", "a", {"id": "z"})
    with pytest.raises(ValueError):
        doc_commands.patch_item(doc, ENCOUNTER, "combatants", "zzz", {})


def test_remove_and_order():
    doc = _doc()
    doc_commands.order_items(doc, ENCOUNTER, "combatants", ["b"])
    assert [c["id"] for c in doc["combatants"]] == ["b", "a"]
    doc_commands.remove_item(doc, ENCOUNTER, "combatants", "b")
    assert [c["id"] for c in doc["combatants"]] == ["a"]
    with pytest.raises(ValueError):
        doc_commands.remove_item(doc, ENCOUNTER, "combatants", "b")
    with pytest.raises(ValueError):
        doc_commands.order_items(doc, ENCOUNTER, "combatants", ["nope"])


def test_adjust_stops_at_the_limits():
    doc = _doc()
    doc_commands.adjust_resource(doc, ENCOUNTER, "combatants", "a", "HP", 5)
    assert doc["combatants"][0]["resources"]["HP"]["current"] == 6
    doc_commands.adjust_resource(doc, ENCOUNTER, "combatants", "a", "HP", -50)
    assert doc["combatants"][0]["resources"]["HP"]["current"] == 0
    with pytest.raises(ValueError, match="resource"):
        doc_commands.adjust_resource(doc, ENCOUNTER, "combatants", "a", "Mana", 1)


def test_only_declared_fields_can_be_patched():
    doc = {"name": "A"}
    doc_commands.patch_doc(doc, ENCOUNTER, {"description": "Ambush"})
    assert doc["description"] == "Ambush"
    for field in ("rev", "round", "turn"):
        with pytest.raises(ValueError):
            doc_commands.patch_doc(doc, ENCOUNTER, {field: 1})


# ── the hub ─────────────────────────────────────────────────────────────────

class FakeSocket:
    def __init__(self, fail=False):
        self.sent, self.fail, self.closed = [], fail, None

    async def send_json(self, event):
        if self.fail:
            raise RuntimeError("gone")
        self.sent.append(event)

    async def close(self, code=1000):
        self.closed = code


@pytest.fixture
def hub_and_collections(tmp_path, monkeypatch):
    monkeypatch.setattr(sync_hub, "FLUSH_DELAY", 0.05)
    backend = LocalDocBackend(tmp_path)
    encounters = DocCollection(ENCOUNTER, backend)
    characters = DocCollection(CHARACTER, backend)
    encounters.create("Fight")
    return DocHub({"encounter": encounters, "character": characters}), encounters, characters


def run(coro):
    return asyncio.run(coro)


def test_a_change_bumps_the_rev_and_reaches_every_client(hub_and_collections):
    hub, _, _ = hub_and_collections

    async def scenario():
        one, two = FakeSocket(), FakeSocket()
        assert hub.connect(one) and hub.connect(two)
        event = await hub.mutate("encounter", "fight", lambda d: doc_commands.patch_doc(d, ENCOUNTER, {"description": "one"}))
        assert event == {"type": "doc", "doc": "encounter:fight", "rev": 1, "set": {"description": "one"}}
        assert one.sent == two.sent == [event]
        again = await hub.mutate("encounter", "fight", lambda d: doc_commands.patch_doc(d, ENCOUNTER, {"description": "two"}))
        assert again["rev"] == 2
        snap = await hub.snapshot("encounter", "fight")
        assert (snap["rev"], snap["description"]) == (2, "two")

    run(scenario())


def test_an_edit_that_changes_nothing_is_not_an_event(hub_and_collections):
    hub, _, _ = hub_and_collections

    async def scenario():
        socket = FakeSocket()
        hub.connect(socket)
        assert await hub.mutate("encounter", "fight", lambda d: None) is None
        assert socket.sent == []
        assert (await hub.snapshot("encounter", "fight"))["rev"] == 0

    run(scenario())


def test_an_invalid_edit_changes_nothing(hub_and_collections):
    hub, _, _ = hub_and_collections

    async def scenario():
        with pytest.raises(ValueError):
            await hub.mutate("encounter", "fight", lambda d: d.update(description="x" * 3000))
        with pytest.raises(ValueError, match="Observatory"):
            await hub.mutate("encounter", "fight", lambda d: doc_commands.add_items(
                d, ENCOUNTER, "combatants", [{"name": "x", "image_url": "https://evil.example/x.png"}]))
        with pytest.raises(ValueError):
            await hub.mutate("encounter", "fight", lambda d: doc_commands.remove_item(d, ENCOUNTER, "combatants", "nope"))
        assert (await hub.snapshot("encounter", "fight"))["rev"] == 0
        with pytest.raises(DocNotFound):
            await hub.snapshot("encounter", "missing")

    run(scenario())


def test_an_encounter_saved_with_rounds_turns_and_initiative_loses_them(hub_and_collections):
    hub, encounters, _ = hub_and_collections
    legacy = encounters.read_raw("fight")
    legacy.update(round=3, turn="a", combatants=[{"id": "a", "name": "A", "initiative": 12, "notes": "keep"}])
    encounters.write_raw("fight", legacy)

    async def scenario():
        snapshot = await hub.snapshot("encounter", "fight")
        assert "round" not in snapshot and "turn" not in snapshot
        assert snapshot["combatants"][0] == {
            **snapshot["combatants"][0], "id": "a", "notes": "keep",
        } and "initiative" not in snapshot["combatants"][0]
        await hub.mutate("encounter", "fight", lambda d: d.update(description="changed"))
        await hub.flush_all()
        assert not {"round", "turn"} & encounters.read_raw("fight").keys()

    run(scenario())


def test_a_socket_that_fails_is_dropped_and_the_others_still_hear(hub_and_collections):
    hub, _, _ = hub_and_collections

    async def scenario():
        broken, fine = FakeSocket(fail=True), FakeSocket()
        hub.connect(broken)
        hub.connect(fine)
        await hub.mutate("encounter", "fight", lambda d: d.update(description="1"))
        assert len(fine.sent) == 1 and broken not in hub._sockets
        await asyncio.sleep(0)
        # Closed too, so a client that was only slow reconnects and catches up.
        assert broken.closed == 1011 and fine.closed is None

    run(scenario())


def test_clients_that_stopped_answering_hold_a_change_up_once_and_not_one_after_another(hub_and_collections, monkeypatch):
    hub, _, _ = hub_and_collections
    monkeypatch.setattr(sync_hub, "SEND_TIMEOUT", 0.2)

    class Asleep:
        async def send_json(self, event):
            await asyncio.sleep(30)  # a phone that went to sleep without closing its socket

    async def scenario():
        asleep, fine = [Asleep() for _ in range(5)], FakeSocket()
        for websocket in (*asleep, fine):
            hub.connect(websocket)
        started = time.monotonic()
        await hub.mutate("encounter", "fight", lambda d: d.update(description="1"))
        took = time.monotonic() - started
        assert took < 0.6, took            # five waits of 0.2s one after another would be 1s
        assert len(fine.sent) == 1 and not any(websocket in hub._sockets for websocket in asleep)

    run(scenario())


def test_the_connection_limit(hub_and_collections, monkeypatch):
    hub, _, _ = hub_and_collections
    monkeypatch.setattr(sync_hub, "MAX_SYNC_CONNECTIONS", 1)
    assert hub.connect(FakeSocket())
    assert not hub.connect(FakeSocket())


def test_a_changed_document_is_saved_after_a_quiet_moment(hub_and_collections):
    hub, encounters, _ = hub_and_collections

    async def scenario():
        await hub.mutate("encounter", "fight", lambda d: d.update(description="4"))
        assert encounters.read_raw("fight")["description"] is None   # not yet
        await asyncio.sleep(0.4)
        saved = encounters.read_raw("fight")
        assert (saved["description"], saved["rev"]) == ("4", 1)

    run(scenario())


def test_flush_all_saves_what_is_pending(hub_and_collections, monkeypatch):
    hub, encounters, _ = hub_and_collections
    monkeypatch.setattr(sync_hub, "FLUSH_DELAY", 60)

    async def scenario():
        await hub.mutate("encounter", "fight", lambda d: d.update(description="7"))
        await hub.flush_all()
        assert encounters.read_raw("fight")["description"] == "7"

    run(scenario())


def test_a_document_saved_by_someone_else_wins(hub_and_collections, monkeypatch):
    hub, encounters, _ = hub_and_collections
    monkeypatch.setattr(sync_hub, "FLUSH_DELAY", 60)

    async def scenario():
        socket = FakeSocket()
        hub.connect(socket)
        await hub.mutate("encounter", "fight", lambda d: d.update(description="1"))
        elsewhere = encounters.read_raw("fight")
        elsewhere.update(rev=40, description="99")
        encounters.write_raw("fight", elsewhere)
        await hub.flush_all()
        assert encounters.read_raw("fight")["description"] == "99"          # not overwritten
        assert (await hub.snapshot("encounter", "fight"))["description"] == "99"
        assert socket.sent[-1] == {"type": "doc", "doc": "encounter:fight", "reset": True}

    run(scenario())


def test_a_failed_save_is_retried_not_lost(hub_and_collections, monkeypatch):
    hub, encounters, _ = hub_and_collections
    monkeypatch.setattr(sync_hub, "FLUSH_RETRY_DELAY", 0.05)
    real_put = encounters.backend.put
    failures = []

    def flaky(key, text):
        if not failures:
            failures.append(key)
            raise OSError("disk full")
        real_put(key, text)

    monkeypatch.setattr(encounters.backend, "put", flaky)

    async def scenario():
        await hub.mutate("encounter", "fight", lambda d: d.update(description="3"))
        await asyncio.sleep(0.5)
        assert failures and encounters.read_raw("fight")["description"] == "3"

    run(scenario())


def test_forgetting_a_document_saves_it_and_tells_clients(hub_and_collections, monkeypatch):
    hub, encounters, _ = hub_and_collections
    monkeypatch.setattr(sync_hub, "FLUSH_DELAY", 60)

    async def scenario():
        socket = FakeSocket()
        hub.connect(socket)
        await hub.mutate("encounter", "fight", lambda d: d.update(description="2"))
        await hub.forget("encounter", "fight")
        assert encounters.read_raw("fight")["description"] == "2"
        assert socket.sent[-1] == {"type": "gone", "doc": "encounter:fight"}
        assert ("encounter", "fight") not in hub._rooms

    run(scenario())


def test_an_idle_saved_document_leaves_memory(hub_and_collections, monkeypatch):
    hub, _, _ = hub_and_collections
    monkeypatch.setattr(sync_hub, "IDLE_UNLOAD_SECONDS", -1)

    async def scenario():
        await hub.snapshot("encounter", "fight")
        await hub.unload_idle()
        assert not hub._rooms
        await hub.mutate("encounter", "fight", lambda d: d.update(description="1"))
        await hub.unload_idle()
        assert hub._rooms                      # unsaved: it stays

    run(scenario())


def test_a_character_follows_its_sheet_and_is_played_like_any_live_document(hub_and_collections):
    hub, _, characters = hub_and_collections

    async def scenario():
        with pytest.raises(DocNotFound):
            await hub.snapshot("character", "aria")
        made = characters.create("Aria", folder_path="party")
        assert made.id == "party/aria" and made.resources == {}
        await hub.mutate("character", "party/aria", lambda d: doc_commands.patch_doc(d, CHARACTER, {"source": ARIA_SHEET}))
        doc = await hub.snapshot("character", "party/aria")
        assert {k: v["current"] for k, v in doc["resources"].items()} == {"HP": 12, "Hope": 2}  # where the sheet says
        event = await hub.mutate("character", "party/aria", lambda d: doc_commands.adjust_own_resource(d, CHARACTER, "HP", -3))
        assert event["set"]["resources"]["HP"]["current"] == 9 and event["doc"] == "character:party/aria"
        # The sheet changes: a max that shrinks keeps the value within it, a
        # counter it no longer has goes, a new one starts where it says.
        smaller = "sections:\n  - counters:\n      HP: 8\n      Armor: { max: 3, start: 0 }\n"
        await hub.mutate("character", "party/aria", lambda d: doc_commands.patch_doc(d, CHARACTER, {"source": smaller}))
        doc = await hub.snapshot("character", "party/aria")
        assert {k: (v["current"], v["max"]) for k, v in doc["resources"].items()} == {"HP": (8, 8), "Armor": (0, 3)}
        with pytest.raises(ValueError, match="whole number"):
            await hub.mutate("character", "party/aria", lambda d: doc_commands.patch_doc(d, CHARACTER, {"source": "sections:\n  - counters: { HP: x }"}))
        await hub.flush_all()
        assert characters.read_raw("party/aria")["resources"]["HP"]["current"] == 8

    run(scenario())


def test_a_character_keeps_its_values_when_renamed(hub_and_collections):
    hub, _, characters = hub_and_collections
    characters.create("Aria")

    async def scenario():
        await hub.mutate("character", "aria", lambda d: doc_commands.patch_doc(d, CHARACTER, {"source": ARIA_SHEET}))
        await hub.mutate("character", "aria", lambda d: doc_commands.adjust_own_resource(d, CHARACTER, "HP", -5))
        await hub.mutate("character", "aria", lambda d: d.update(name="Aria la Roja"))
        doc = await hub.snapshot("character", "aria")
        assert (doc["name"], doc["resources"]["HP"]["current"]) == ("Aria la Roja", 7)

    run(scenario())


# ── routes ──────────────────────────────────────────────────────────────────

def observatory_of(encounters, characters):
    return Observatory(encounters.backend, {"encounter": encounters, "character": characters})


@pytest.fixture
def api(hub_and_collections, monkeypatch):
    hub, encounters, characters = hub_and_collections
    app = FastAPI()
    app.include_router(make_doc_router(ENCOUNTER, encounters, hub, viewer=lambda request, doc_id: None))
    app.include_router(make_doc_router(CHARACTER, characters, hub, viewer=lambda request, doc_id: None))
    app.state.observatory = observatory_of(encounters, characters)
    app.include_router(make_observatory_router(app.state.observatory, hub, {}, image_viewer=lambda request, name: None))
    app.include_router(sync_routes.router)
    app.dependency_overrides[require_auth] = lambda: {"email": "gm@example.com", "name": "GM"}
    monkeypatch.setattr(sync_routes, "hub", hub)
    monkeypatch.setattr(sync_routes, "current_user", lambda websocket: {"email": "gm@example.com"})
    with TestClient(app) as client:
        yield client


def test_create_list_rename_move_and_delete_over_http(api):
    created = api.post("/api/encounters", json={"name": "Ambush", "folder_path": "goblins"}).json()
    assert created["id"] == "goblins/ambush"
    tree = api.get("/api/observatory", params={"path": "goblins"}).json()
    assert [(e["kind"], e["id"]) for e in tree["items"]] == [("encounter", "goblins/ambush")]
    assert api.get("/api/encounters/all").json()["encounters"][0]["name"] in ("Fight", "Ambush")
    assert api.post("/api/encounters/rename", json={"id": "goblins/ambush", "name": "Big ambush"}).json()["rev"] == 1
    moved = api.post("/api/encounters/move", json={"id": "goblins/ambush", "folder_path": ""}).json()
    assert moved["id"] == "ambush"
    assert api.get("/api/encounters/ambush").json()["name"] == "Big ambush"
    assert api.get("/api/encounters/goblins/ambush").status_code == 404
    assert api.delete("/api/encounters/ambush").json() == {"status": "success"}
    assert api.get("/api/encounters/ambush").status_code == 404


def test_the_commands_over_http(api):
    added = api.post("/api/encounters/fight/combatants", json={"items": [
        {"id": "orc", "name": "Orc 1", "resources": {"HP": {"current": 6, "max": 6}}},
        {"id": "orc2", "name": "Orc 2", "resources": {"HP": {"current": 6, "max": 6}}},
    ]})
    assert added.status_code == 200 and added.json()["rev"] == 1
    hit = api.post("/api/encounters/fight/combatants/orc/adjust", json={"resource": "HP", "by": -4}).json()
    assert hit["upsert"]["combatants"][0]["resources"]["HP"]["current"] == 2
    snapshot = api.get("/api/encounters/fight").json()
    assert [c["resources"]["HP"]["current"] for c in snapshot["combatants"]] == [2, 6]   # the copies are independent
    api.patch("/api/encounters/fight/combatants/orc", json={"conditions": [{"id": "c1", "name": "Prone"}]})
    api.post("/api/encounters/fight/combatants/order", json={"ids": ["orc2"]})
    api.patch("/api/encounters/fight", json={"description": "Cave"})
    snapshot = api.get("/api/encounters/fight").json()
    assert [c["id"] for c in snapshot["combatants"]] == ["orc2", "orc"]
    assert (snapshot["description"], snapshot["rev"]) == ("Cave", 5)
    assert api.delete("/api/encounters/fight/combatants/orc").status_code == 200


def test_mistakes_get_the_right_status(api):
    assert api.post("/api/encounters/fight/combatants/ghost/adjust", json={"resource": "HP", "by": 1}).status_code == 400
    assert api.patch("/api/encounters/fight", json={"rev": 5}).status_code == 400
    assert api.patch("/api/encounters/fight", json={"round": 2}).status_code == 400   # no rounds in an encounter
    assert api.post("/api/encounters/nothing/combatants", json={"items": [{"name": "x"}]}).status_code == 404
    assert api.post("/api/encounters/fight/combatants", json={"items": [{"name": "x", "type": "monster"}]}).status_code == 400
    assert api.post("/api/encounters/fight/combatants/orc/adjust", json={"resource": "HP", "by": 99999}).status_code == 422
    assert api.post("/api/encounters", json={"name": "   "}).status_code == 400
    assert api.post("/api/encounters/rename", json={"id": "fight", "name": "   "}).status_code == 400  # as for the saved kinds
    assert api.get("/api/encounters/fight").json()["name"] == "Fight"


def test_a_character_cannot_be_in_an_encounter_twice_nor_carry_counters(api):
    entry = {"name": "Aria", "type": "character", "sheet": "aria"}
    assert api.post("/api/encounters/fight/combatants", json={"items": [entry]}).status_code == 200
    assert api.post("/api/encounters/fight/combatants", json={"items": [entry]}).status_code == 400
    with_counters = {"name": "Bram", "type": "character", "sheet": "bram", "resources": {"HP": {"current": 1, "max": 1}}}
    assert api.post("/api/encounters/fight/combatants", json={"items": [with_counters]}).status_code == 400


def test_characters_over_http(api):
    assert api.get("/api/characters/all").json()["characters"] == []
    assert api.get("/api/characters/aria").status_code == 404
    made = api.post("/api/characters", json={"name": "Aria", "folder_path": "party"}).json()
    assert made["id"] == "party/aria"
    patched = api.patch("/api/characters/party/aria", json={"source": ARIA_SHEET + "subtitle: Ranger\n"}).json()
    assert patched["set"]["resources"]["HP"] == {"current": 12, "max": 12, "min": 0, "color": None, "style": None}
    assert api.post("/api/characters/party/aria/adjust", json={"resource": "HP", "by": -5}).json()["rev"] == 2
    assert api.get("/api/characters/party/aria").json()["resources"]["HP"]["current"] == 7
    assert api.patch("/api/characters/party/aria", json={"resources": {}}).status_code == 400   # they follow the sheet
    assert api.patch("/api/characters/party/aria", json={"source": "- not a mapping"}).status_code == 400
    assert api.get("/api/characters/party/aria").json()["subtitle"] == "Ranger"   # what its card shows
    listed = api.get("/api/observatory", params={"path": "party"}).json()["items"]
    assert [(c["kind"], c["id"]) for c in listed] == [("character", "party/aria")]


def test_moving_characters_tells_whoever_names_them(hub_and_collections):
    hub, _, characters = hub_and_collections
    moves = []

    async def follow(moved, user):
        moves.append(moved)

    app = FastAPI()
    app.include_router(make_doc_router(CHARACTER, characters, hub, on_moved=follow))
    app.include_router(make_observatory_router(
        observatory_of(hub_and_collections[1], characters), hub, {"character": follow}, image_viewer=lambda r, n: None,
    ))
    app.dependency_overrides[require_auth] = lambda: {"email": "gm@example.com"}
    with TestClient(app) as api:
        api.post("/api/characters", json={"name": "Aria", "folder_path": "party"})
        api.post("/api/characters", json={"name": "Bram", "folder_path": "party/old"})
        assert api.post("/api/characters/move", json={"id": "party/aria", "folder_path": ""}).json()["id"] == "aria"
        api.put("/api/observatory/folders/party", json={"name": "heroes"})
        api.post("/api/observatory/folders/move", json={"path": "heroes/old", "dest_parent_path": ""})
        api.post("/api/characters/move", json={"id": "aria", "folder_path": ""})   # stays: nothing to tell
    assert moves == [{"party/aria": "aria"}, {"party/old/bram": "heroes/old/bram"}, {"heroes/old/bram": "old/bram"}]


def test_every_client_hears_the_change_on_the_socket(api):
    with api.websocket_connect("/ws/sync") as socket:
        api.post("/api/encounters/fight/combatants", json={"items": [{"id": "orc", "name": "Orc"}]})
        event = socket.receive_json()
        assert event["doc"] == "encounter:fight" and event["rev"] == 1
        assert event["upsert"]["combatants"][0]["id"] == "orc"


def test_the_socket_needs_a_signed_in_user(api, monkeypatch):
    monkeypatch.setattr(sync_routes, "current_user", lambda websocket: None)
    with pytest.raises(Exception):
        with api.websocket_connect("/ws/sync") as socket:
            socket.receive_json()


def test_deleting_a_document_tells_the_clients_showing_it(api):
    api.post("/api/encounters", json={"name": "Temp"})
    with api.websocket_connect("/ws/sync") as socket:
        api.get("/api/encounters/temp")
        api.post("/api/encounters/temp/combatants", json={"items": [{"name": "x"}]})
        socket.receive_json()
        api.delete("/api/encounters/temp")
        assert socket.receive_json() == {"type": "gone", "doc": "encounter:temp"}


def _a_late_command_loads_the_document_again(hub, encounters, doc_id):
    """What a command does that reaches the server after the document's room
    was forgotten but before it is gone from storage: it loads the room again,
    from where the document still is, and changes it (so it will be saved)."""
    raw = encounters.read_raw(doc_id)
    room = sync_hub.Room(ENCOUNTER, doc_id, Encounter.model_validate(raw).model_dump(mode="json"))
    room.dirty = True
    hub._rooms[("encounter", doc_id)] = room


def test_a_command_that_slips_in_while_a_document_is_deleted_does_not_bring_it_back(api, hub_and_collections, monkeypatch):
    hub, encounters, _ = hub_and_collections
    api.post("/api/encounters", json={"name": "Temp"})
    api.get("/api/encounters/temp")
    real_delete = encounters.delete

    def delete(doc_id):
        _a_late_command_loads_the_document_again(hub, encounters, "temp")
        real_delete(doc_id)

    monkeypatch.setattr(encounters, "delete", delete)
    assert api.delete("/api/encounters/temp").status_code == 200
    assert ("encounter", "temp") not in hub._rooms
    run(hub.flush_all())
    assert encounters.read_raw("temp") is None


def test_nor_while_it_is_moved_or_its_folder_is(api, hub_and_collections, monkeypatch):
    hub, encounters, _ = hub_and_collections
    observatory = api.app.state.observatory
    api.post("/api/encounters", json={"name": "Moving", "folder_path": "old"})
    api.get("/api/encounters/old/moving")
    real_move = observatory.move_folder

    def move_folder(path, new_parent_path=None, new_name=None):
        _a_late_command_loads_the_document_again(hub, encounters, "old/moving")
        return real_move(path, new_parent_path, new_name)

    monkeypatch.setattr(observatory, "move_folder", move_folder)
    assert api.put("/api/observatory/folders/old", json={"name": "new"}).status_code == 200
    run(hub.flush_all())
    assert encounters.read_raw("old/moving") is None
    assert encounters.read_raw("new/moving")["name"] == "Moving"

    api.get("/api/encounters/new/moving")
    real_move_item = encounters.move_item

    def move_item(doc_id, dest):
        _a_late_command_loads_the_document_again(hub, encounters, "new/moving")
        return real_move_item(doc_id, dest)

    monkeypatch.setattr(encounters, "move_item", move_item)
    assert api.post("/api/encounters/move", json={"id": "new/moving", "folder_path": ""}).json()["id"] == "moving"
    run(hub.flush_all())
    assert encounters.read_raw("new/moving") is None


def test_a_command_that_lands_during_the_last_save_does_not_bring_a_deleted_document_back(hub_and_collections, monkeypatch):
    hub, encounters, _ = hub_and_collections
    monkeypatch.setattr(sync_hub, "FLUSH_DELAY", 60)
    real_write = encounters.write_raw

    def slow_write(doc_id, data):
        time.sleep(0.2)   # an S3 PUT
        return real_write(doc_id, data)

    async def scenario():
        await hub.mutate("encounter", "fight", lambda d: d.update(description="a"))
        monkeypatch.setattr(encounters, "write_raw", slow_write)

        async def delete():
            async with hub.released("encounter", ["fight"]):
                await asyncio.to_thread(encounters.delete, "fight")

        async def late_command():
            await asyncio.sleep(0.05)   # while the last save is being written
            with pytest.raises(DocNotFound):
                await hub.mutate("encounter", "fight", lambda d: d.update(description="b"))

        await asyncio.gather(delete(), late_command())
        await hub.flush_all()
        await asyncio.sleep(0.3)
        assert encounters.read_raw("fight") is None
        assert ("encounter", "fight") not in hub._rooms

    run(scenario())


def test_a_document_whose_last_save_fails_is_not_moved_or_deleted(hub_and_collections, monkeypatch):
    hub, encounters, _ = hub_and_collections
    monkeypatch.setattr(sync_hub, "FLUSH_DELAY", 60)
    monkeypatch.setattr(sync_hub, "FLUSH_RETRY_DELAY", 60)

    def broken(doc_id, data):
        raise OSError("disk full")

    async def scenario():
        await hub.mutate("encounter", "fight", lambda d: d.update(description="unsaved"))
        monkeypatch.setattr(encounters, "write_raw", broken)
        with pytest.raises(OSError):
            async with hub.released("encounter", ["fight"]):
                pytest.fail("the delete must not run")
        # Still held, still to be saved, and usable.
        assert hub.held("encounter", "fight")["description"] == "unsaved"
        await hub.mutate("encounter", "fight", lambda d: d.update(description="still here"))

    run(scenario())


def test_the_hub_knows_a_document_by_its_id_however_it_is_written(hub_and_collections):
    hub, _, _ = hub_and_collections

    async def scenario():
        await hub.mutate("encounter", "fight/", lambda d: d.update(description="1"))
        await hub.mutate("encounter", "/fight", lambda d: d.update(description="2"))
        assert list(hub._rooms) == [("encounter", "fight")]
        assert (await hub.snapshot("encounter", "fight"))["rev"] == 2

    run(scenario())


def test_discarding_a_room_drops_its_pending_save(hub_and_collections, monkeypatch):
    hub, encounters, _ = hub_and_collections
    monkeypatch.setattr(sync_hub, "FLUSH_DELAY", 60)

    async def scenario():
        await hub.mutate("encounter", "fight", lambda d: d.update(description="unsaved"))
        hub.discard("encounter", "fight")
        hub.discard("encounter", "never-loaded")  # nothing to do, and no error
        await hub.flush_all()
        assert ("encounter", "fight") not in hub._rooms
        assert encounters.read_raw("fight")["description"] is None

    run(scenario())


def test_everything_needs_a_signed_in_user(hub_and_collections):
    hub, encounters, _ = hub_and_collections
    app = FastAPI()
    app.include_router(make_doc_router(ENCOUNTER, encounters, hub))
    # no dependency override: require_auth consults the app's settings, where
    # nobody is signed in on a test request without a session cookie
    from config.settings import settings
    if not settings.ENABLE_AUTH:
        pytest.skip("authentication is switched off in this environment")
    with TestClient(app) as client:
        assert client.get("/api/encounters/fight").status_code == 401
        assert client.post("/api/encounters/fight/combatants", json={"items": []}).status_code == 401
        assert client.get("/api/encounters/all").status_code == 401
