"""Battlemaps: the model, what a screen is shown of one, how the screens follow
it, and the routes. Run from backend/:  python -m pytest tests/test_battlemap.py
"""
import asyncio
import time

import pytest
from fastapi.testclient import TestClient

from main import app
from models.battlemap import Battlemap
from routes import screen
from services import battlemap_screen, doc_commands, storage_service, sync_hub
from services.auth_service import SCREEN_COOKIE_NAME, SESSION_COOKIE_NAME, create_screen_key, create_session_token
from services.battlemap_projection import project_for_screen
from services.battlemap_screen import BattlemapScreen
from services.doc_backend import LocalDocBackend
from services.doc_collection import DocCollection, DocNotFound
from services.doc_registry import BATTLEMAP, CHARACTER, ENCOUNTER
from services.sync_hub import DocHub

LIB = "/api/observatory/images/"
MAP_IMAGE = f"{LIB}bb000001-cave.png"
ORC_IMAGE = f"{LIB}bb000002-orc.png"
DRAGON_IMAGE = f"{LIB}bb000003-dragon.png"


# ── the model ───────────────────────────────────────────────────────────────

def test_a_new_map_is_a_square_grid_with_snapping_and_nothing_on_it():
    battlemap = Battlemap(id="cave", name="Cave")
    assert battlemap.grid.type == "square" and battlemap.grid.snap and battlemap.tokens == []
    assert (battlemap.grid.distance, battlemap.grid.unit, battlemap.grid.measure) == (1, "cell", "grid")


def test_what_a_cell_is_worth_is_the_tables_to_say():
    battlemap = Battlemap(id="c", name="C", grid={"distance": 1.5, "unit": "m", "measure": "straight"})
    assert (battlemap.grid.distance, battlemap.grid.unit) == (1.5, "m")


@pytest.mark.parametrize("grid", [{"size": 1}, {"size": 99999}, {"opacity": 2}, {"distance": 0}, {"type": "hex"}])
def test_nonsense_grids_are_refused(grid):
    with pytest.raises(ValueError):
        Battlemap(id="c", name="C", grid=grid)


def test_token_ids_are_unique():
    with pytest.raises(ValueError, match="unique"):
        Battlemap(id="c", name="C", tokens=[{"id": "a"}, {"id": "a"}])


# ── what a screen is shown ──────────────────────────────────────────────────

def _map(**overrides):
    return {
        "id": "cave", "name": "Cave", "image_url": MAP_IMAGE, "encounter": "fight",
        "grid": {"type": "square", "size": 70, "snap": True, "visible": True, "color": "#fff", "opacity": 0.3,
                 "distance": 5, "unit": "ft", "measure": "grid", "offset_x": 0, "offset_y": 0},
        "tokens": [
            {"id": "orc", "name": "Orc", "x": 3, "y": 4, "size": 1, "image_url": ORC_IMAGE, "combatant": "c1",
             "sheet": "Bestiary/Orc#orc", "show_bars": True, "bars": ["HP"]},
            {"id": "dragon", "name": "Dragon", "x": 9, "y": 9, "size": 3, "image_url": DRAGON_IMAGE, "hidden": True},
            {"id": "aria", "name": "Aria", "x": 1, "y": 1, "combatant": "c2", "show_bars": True, "bars": ["HP", "Nope"]},
            {"id": "quiet", "name": "Quiet", "x": 2, "y": 2, "combatant": "c1", "show_bars": False, "bars": ["HP"]},
        ],
        **overrides,
    }


ENCOUNTER_DOC = {"combatants": [
    {"id": "c1", "type": "adversary", "sheet": "Bestiary/Orc#orc",
     "resources": {"HP": {"current": 2, "max": 6, "min": 0, "color": "red", "style": None}, "Stress": {"current": 1, "max": 3}}},
    {"id": "c2", "type": "character", "sheet": "aria", "resources": {}},
]}
CHARACTERS_DOC = {"aria": {"id": "aria", "resources": {"HP": {"current": 9, "max": 12, "min": 0}}}}


def test_a_hidden_token_never_reaches_a_screen():
    shown = project_for_screen(_map(), ENCOUNTER_DOC, CHARACTERS_DOC)
    assert [t["id"] for t in shown["tokens"]] == ["orc", "aria", "quiet"]
    assert "dragon" not in str(shown).lower()
    assert DRAGON_IMAGE not in str(shown)


def test_a_screen_learns_nothing_of_who_a_token_stands_for():
    shown = project_for_screen(_map(), ENCOUNTER_DOC, CHARACTERS_DOC)
    for token in shown["tokens"]:
        assert not {"sheet", "combatant", "bars", "show_bars", "hidden"} & set(token)
    assert "Bestiary" not in str(shown) and "encounter" not in shown and "c1" not in str(shown)


def test_a_token_shows_only_the_counters_it_was_told_to():
    tokens = {t["id"]: t for t in project_for_screen(_map(), ENCOUNTER_DOC, CHARACTERS_DOC)["tokens"]}
    assert tokens["orc"]["meters"] == [{"name": "HP", "current": 2, "max": 6, "min": 0, "color": "red", "style": None}]
    assert tokens["quiet"]["meters"] == []                       # show_bars is off
    assert [m["name"] for m in tokens["aria"]["meters"]] == ["HP"]   # "Nope" is not a counter of hers
    assert tokens["aria"]["meters"][0]["current"] == 9            # a character's saved value


def test_a_token_with_no_combatant_or_encounter_shows_no_counters():
    shown = project_for_screen(_map(encounter=None), None, None)
    assert all(t["meters"] == [] for t in shown["tokens"])


def test_the_map_and_its_grid_are_what_a_screen_needs_to_draw_it():
    shown = project_for_screen(_map(), ENCOUNTER_DOC, CHARACTERS_DOC)
    assert shown["battlemap_id"] == "cave" and shown["image_url"] == MAP_IMAGE
    assert shown["grid"]["distance"] == 5 and shown["grid"]["unit"] == "ft"
    assert "snap" not in shown["grid"]


# ── commands ────────────────────────────────────────────────────────────────

def test_changing_one_grid_setting_keeps_the_others():
    doc = Battlemap(id="c", name="C").model_dump()
    doc_commands.patch_doc(doc, BATTLEMAP, {"grid": {"size": 100}})
    assert doc["grid"]["size"] == 100 and doc["grid"]["snap"] is True and doc["grid"]["unit"] == "cell"
    with pytest.raises(ValueError):
        doc_commands.patch_doc(doc, BATTLEMAP, {"tokens": []})


# ── the hub tells its listeners ─────────────────────────────────────────────

@pytest.fixture
def world(tmp_path, monkeypatch):
    monkeypatch.setattr(sync_hub, "FLUSH_DELAY", 60)
    monkeypatch.setattr(battlemap_screen, "COALESCE", 0.02)
    backend = LocalDocBackend(tmp_path)
    collections = {c.kind: DocCollection(c, backend) for c in (BATTLEMAP, ENCOUNTER, CHARACTER)}
    collections["battlemap"].create("Cave")
    collections["encounter"].create("Fight")
    return DocHub(collections)


def test_a_screen_that_stopped_answering_holds_nobody_up():
    manager = screen.ConnectionManager()
    manager.screens.send_timeout = 0.2

    class Asleep:
        async def send_json(self, message):
            await asyncio.sleep(30)   # a TV switched off at the wall

    class Awake:
        def __init__(self):
            self.sent = []

        async def send_json(self, message):
            self.sent.append(message)

    awake = Awake()
    for websocket in (Asleep(), Asleep(), Asleep(), awake):
        manager.screens.add(websocket)
    started = time.monotonic()
    asyncio.run(manager.broadcast({"type": "clear_screen"}, {"type": "display_media", "url": None}))
    assert time.monotonic() - started < 0.6   # once, not once per screen and message
    assert [m["type"] for m in awake.sent] == ["clear_screen", "display_media"]
    assert manager.active_connections == [awake]


class FakeManager:
    def __init__(self):
        self.current_state = None
        self.sent = []

    async def broadcast(self, *messages):
        for message in messages:
            self.sent.append(message)
            if message["type"] not in screen.LIVE_UPDATE_TYPES:
                self.current_state = message


def add_token(hub, **token):
    return hub.mutate("battlemap", "cave", lambda d: doc_commands.add_items(d, BATTLEMAP, "tokens", [token]))


def test_a_listener_hears_every_event_and_cannot_break_the_change(world):
    heard = []

    async def listener(event):
        heard.append(event["rev"])

    async def broken(event):
        raise RuntimeError("nope")

    world.add_listener(broken)
    world.add_listener(listener)

    async def scenario():
        event = await add_token(world, id="t", name="T", x=1, y=1)
        assert heard == [event["rev"]]

    asyncio.run(scenario())


def test_showing_a_map_sends_a_pointer_and_what_a_screen_may_see(world):
    manager = FakeManager()
    shown = BattlemapScreen(world, manager)

    async def scenario():
        await add_token(world, id="a", name="Orc", x=1, y=1, image_url=ORC_IMAGE)
        await add_token(world, id="b", name="Dragon", x=5, y=5, hidden=True, image_url=DRAGON_IMAGE)
        await shown.show("cave")
        assert [m["type"] for m in manager.sent] == ["display_battlemap", "update_battlemap"]
        assert manager.sent[0] == {"type": "display_battlemap", "battlemap_id": "cave"}
        assert [t["id"] for t in manager.sent[1]["tokens"]] == ["a"]
        assert shown.displayed() == "cave"
        with pytest.raises(DocNotFound):
            await shown.show("missing")

    asyncio.run(scenario())


def test_a_map_linked_to_an_encounter_that_is_gone_or_not_even_an_id_is_still_shown(world):
    manager = FakeManager()
    shown = BattlemapScreen(world, manager)

    async def scenario():
        for encounter in ("deleted-long-ago", "../../etc/passwd", "a//b"):
            await world.mutate("battlemap", "cave", lambda d, e=encounter: d.update(encounter=e))
            manager.sent.clear()
            await shown.show("cave")
            assert [m["type"] for m in manager.sent] == ["display_battlemap", "update_battlemap"], encounter
        with pytest.raises(ValueError):
            await shown.show("../x")

    asyncio.run(scenario())


def test_the_screens_follow_changes_to_the_map_a_moment_later_and_not_one_by_one(world):
    manager = FakeManager()
    shown = BattlemapScreen(world, manager)
    world.add_listener(shown.on_event)

    async def scenario():
        await add_token(world, id="a", name="Orc", x=1, y=1)
        await shown.show("cave")
        manager.sent.clear()
        for x in (2, 3, 4):
            await world.mutate("battlemap", "cave", lambda d, x=x: doc_commands.patch_item(d, BATTLEMAP, "tokens", "a", {"x": x}))
        await asyncio.sleep(0.2)
        assert [m["type"] for m in manager.sent] == ["update_battlemap"]   # coalesced
        assert manager.sent[0]["tokens"][0]["x"] == 4

    asyncio.run(scenario())


def test_the_counters_a_token_shows_follow_its_encounter_and_the_characters(world):
    manager = FakeManager()
    shown = BattlemapScreen(world, manager)
    world.add_listener(shown.on_event)

    async def scenario():
        await world.mutate("encounter", "fight", lambda d: doc_commands.add_items(d, ENCOUNTER, "combatants", [
            {"id": "c1", "name": "Orc", "resources": {"HP": {"current": 6, "max": 6}}},
        ]))
        await world.mutate("battlemap", "cave", lambda d: doc_commands.patch_doc(d, BATTLEMAP, {"encounter": "fight"}))
        await add_token(world, id="a", name="Orc", x=1, y=1, combatant="c1", show_bars=True, bars=["HP"])
        await shown.show("cave")
        manager.sent.clear()
        await world.mutate("encounter", "fight", lambda d: doc_commands.adjust_resource(d, ENCOUNTER, "combatants", "c1", "HP", -4))
        await asyncio.sleep(0.2)
        assert manager.sent[-1]["tokens"][0]["meters"][0]["current"] == 2

        # A character's counters are its own document's.
        world._collections["character"].create("Aria")
        await world.mutate("character", "aria", lambda d: d.update(source="sections:\n  - counters: { HP: { max: 12, start: 9 } }\n"))
        await world.mutate("encounter", "fight", lambda d: doc_commands.add_items(d, ENCOUNTER, "combatants", [
            {"id": "c2", "name": "Aria", "type": "character", "sheet": "aria"},
        ]))
        await add_token(world, id="b", name="Aria", x=2, y=1, combatant="c2", show_bars=True, bars=["HP"])
        await world.mutate("character", "aria", lambda d: doc_commands.adjust_own_resource(d, CHARACTER, "HP", -3))
        await asyncio.sleep(0.2)
        aria = next(t for t in manager.sent[-1]["tokens"] if t["id"] == "b")
        assert aria["meters"][0]["current"] == 6

    asyncio.run(scenario())


def test_changes_to_other_things_do_not_wake_the_screens(world, tmp_path):
    manager = FakeManager()
    shown = BattlemapScreen(world, manager)
    world.add_listener(shown.on_event)
    world._collections["encounter"].create("Elsewhere")

    async def scenario():
        await shown.show("cave")                       # no encounter attached
        manager.sent.clear()
        await world.mutate("encounter", "elsewhere", lambda d: d.update(description="elsewhere"))
        await asyncio.sleep(0.1)
        assert manager.sent == []
        manager.current_state = {"type": "display_media", "url": "x"}   # something else is on screen now
        await add_token(world, id="a", name="Orc", x=1, y=1)
        await asyncio.sleep(0.1)
        assert manager.sent == []

    asyncio.run(scenario())


def test_deleting_the_map_on_screen_clears_the_screens(world):
    manager = FakeManager()
    shown = BattlemapScreen(world, manager)
    world.add_listener(shown.on_event)

    async def scenario():
        await shown.show("cave")
        manager.sent.clear()
        await world.forget("battlemap", "cave")
        assert manager.sent == [{"type": "clear_screen"}]

    asyncio.run(scenario())


# ── over HTTP, with the real app ────────────────────────────────────────────

@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture
def gm(client, monkeypatch):
    import io
    from services.doc_registry import observatory
    for url in (MAP_IMAGE, ORC_IMAGE, DRAGON_IMAGE):
        observatory.backend.put_file(f"observatory/maps/{url.removeprefix(LIB)}", io.BytesIO(b"png"), "image/png")
    observatory._forget_index()   # put straight in the store, not uploaded
    monkeypatch.setattr(screen.manager, "current_state", None)
    monkeypatch.setattr(screen.manager, "live_draft", None)
    client.cookies.clear()
    client.cookies.set(SESSION_COOKIE_NAME, create_session_token("gm@example.com"))
    yield client
    client.cookies.clear()


def test_a_map_and_its_tokens_over_http(gm):
    created = gm.post("/api/battlemaps", json={"name": "HTTP cave"}).json()
    base = f"/api/battlemaps/{created['id']}"
    assert gm.patch(base, json={"image_url": MAP_IMAGE, "grid": {"size": 100, "unit": "ft", "distance": 5}}).status_code == 200
    token = gm.post(f"{base}/tokens", json={"items": [{"id": "orc", "name": "Orc", "x": 2, "y": 3, "image_url": ORC_IMAGE}]})
    assert token.status_code == 200
    moved = gm.patch(f"{base}/tokens/orc", json={"x": 4.0, "y": 5.0}).json()
    assert moved["upsert"]["tokens"][0]["x"] == 4.0
    doc = gm.get(base).json()
    assert doc["grid"]["size"] == 100 and doc["grid"]["snap"] is True      # one setting changed, the rest kept
    assert doc["tokens"][0]["y"] == 5.0 and doc["image_url"] == MAP_IMAGE
    assert gm.delete(f"{base}/tokens/orc").status_code == 200


def test_only_library_images_and_sane_tokens(gm):
    base = f"/api/battlemaps/{gm.post('/api/battlemaps', json={'name': 'Strict cave'}).json()['id']}"
    assert gm.patch(base, json={"image_url": "https://evil.example/map.png"}).status_code == 400
    assert gm.post(f"{base}/tokens", json={"items": [{"name": "x", "image_url": "https://evil.example/t.png"}]}).status_code == 400
    assert gm.post(f"{base}/tokens", json={"items": [{"name": "x", "size": 0}]}).status_code == 400
    assert gm.patch(base, json={"grid": {"type": "hex"}}).status_code == 400
    assert gm.patch(base, json={"tokens": []}).status_code == 400


def test_showing_a_map_needs_a_login_and_an_existing_map(gm, client):
    assert gm.post("/api/screen/battlemap", json={"battlemap_id": "nothing"}).status_code == 404
    assert gm.post("/api/screen/battlemap", json={"battlemap_id": "../x"}).status_code == 400
    client.cookies.clear()
    assert client.post("/api/screen/battlemap", json={"battlemap_id": "anything"}).status_code == 401


def _paired(client):
    client.cookies.clear()
    client.cookies.set(SCREEN_COOKIE_NAME, create_screen_key("gm@example.com"))


def test_a_paired_screen_sees_the_map_and_only_the_images_it_may(gm, client):
    base = f"/api/battlemaps/{gm.post('/api/battlemaps', json={'name': 'Screen cave'}).json()['id']}"
    gm.patch(base, json={"image_url": MAP_IMAGE})
    gm.post(f"{base}/tokens", json={"items": [
        {"id": "orc", "name": "Orc", "x": 1, "y": 1, "image_url": ORC_IMAGE},
        {"id": "dragon", "name": "Dragon", "x": 2, "y": 2, "image_url": DRAGON_IMAGE, "hidden": True},
    ]})
    gm.cookies.clear()
    gm.cookies.set(SESSION_COOKIE_NAME, create_session_token("gm@example.com"))
    assert gm.post("/api/screen/battlemap", json={"battlemap_id": "screen-cave"}).status_code == 200

    _paired(client)
    assert client.get(MAP_IMAGE).status_code == 200
    assert client.get(ORC_IMAGE).status_code == 200
    assert client.get(DRAGON_IMAGE).status_code == 401   # hidden: not on screen
    assert client.get("/api/battlemaps/screen-cave").status_code == 401    # the map itself stays behind login


def test_the_screens_hear_the_map_and_what_changes_on_it(gm, client):
    base = f"/api/battlemaps/{gm.post('/api/battlemaps', json={'name': 'Live cave'}).json()['id']}"
    gm.post(f"{base}/tokens", json={"items": [
        {"id": "orc", "name": "Orc", "x": 1, "y": 1},
        {"id": "dragon", "name": "Dragon", "x": 2, "y": 2, "hidden": True},
    ]})
    _paired(client)
    with client.websocket_connect("/ws/screen") as socket:
        gm.cookies.clear()
        gm.cookies.set(SESSION_COOKIE_NAME, create_session_token("gm@example.com"))
        gm.post("/api/screen/battlemap", json={"battlemap_id": "live-cave"})
        assert socket.receive_json() == {"type": "display_battlemap", "battlemap_id": "live-cave"}
        update = socket.receive_json()
        assert update["type"] == "update_battlemap" and [t["id"] for t in update["tokens"]] == ["orc"]

        gm.patch(f"{base}/tokens/orc", json={"x": 7})
        moved = socket.receive_json()
        assert moved["tokens"][0]["x"] == 7
        gm.patch(f"{base}/tokens/dragon", json={"hidden": False})
        revealed = socket.receive_json()
        assert [t["id"] for t in revealed["tokens"]] == ["orc", "dragon"]


def test_a_screen_that_connects_later_gets_the_map_as_it_is(gm, client):
    base = f"/api/battlemaps/{gm.post('/api/battlemaps', json={'name': 'Late cave'}).json()['id']}"
    gm.post(f"{base}/tokens", json={"items": [{"id": "orc", "name": "Orc", "x": 1, "y": 1}]})
    gm.post("/api/screen/battlemap", json={"battlemap_id": "late-cave"})
    gm.patch(f"{base}/tokens/orc", json={"x": 9})
    time.sleep(0.3)
    _paired(client)
    with client.websocket_connect("/ws/screen") as socket:
        assert socket.receive_json()["type"] == "display_battlemap"
        assert socket.receive_json()["tokens"][0]["x"] == 9


def test_a_character_moved_is_followed_by_its_encounters_and_tokens(gm):
    gm.post("/api/characters", json={"name": "Vex"})
    gm.patch("/api/characters/vex", json={"source": "sections:\n  - counters: { HP: { max: 9, start: 4 } }\n"})
    fight = gm.post("/api/encounters", json={"name": "Vex fight"}).json()["id"]
    gm.post(f"/api/encounters/{fight}/combatants", json={"items": [
        {"id": "v", "name": "Vex", "type": "character", "sheet": "vex"},
        {"id": "o", "name": "Vex (an adversary that happens to share the id)", "sheet": "vex"},
    ]})
    cave = gm.post("/api/battlemaps", json={"name": "Vex cave"}).json()["id"]
    gm.patch(f"/api/battlemaps/{cave}", json={"encounter": fight})
    gm.post(f"/api/battlemaps/{cave}/tokens", json={"items": [
        {"id": "t", "name": "Vex", "sheet": "vex", "combatant": "v"},
        {"id": "u", "name": "The adversary", "sheet": "vex", "combatant": "o"},
    ]})

    assert gm.post("/api/characters/move", json={"id": "vex", "folder_path": "party"}).json()["id"] == "party/vex"
    assert [c["sheet"] for c in gm.get(f"/api/encounters/{fight}").json()["combatants"]] == ["party/vex", "vex"]
    # A token is of its combatant's type: the adversary's token stays.
    assert [t["sheet"] for t in gm.get(f"/api/battlemaps/{cave}").json()["tokens"]] == ["party/vex", "vex"]


def test_a_moved_encounter_is_followed_by_the_maps_that_use_it(gm):
    fight = gm.post("/api/encounters", json={"name": "Moving fight"}).json()["id"]
    cave = gm.post("/api/battlemaps", json={"name": "Moving cave"}).json()["id"]
    other = gm.post("/api/battlemaps", json={"name": "Unrelated cave"}).json()["id"]
    gm.patch(f"/api/battlemaps/{cave}", json={"encounter": fight})

    moved = gm.post("/api/encounters/move", json={"id": fight, "folder_path": "act-2"}).json()["id"]
    assert moved == f"act-2/{fight}"
    assert gm.get(f"/api/battlemaps/{cave}").json()["encounter"] == moved
    assert gm.get(f"/api/battlemaps/{other}").json()["encounter"] is None
    assert gm.get("/api/characters/party/vex").json()["resources"]["HP"]["current"] == 4