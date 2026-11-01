"""The relative edit of an entity's list (a combatant's conditions, a token's
bars): two people adding at once both add. Run from backend/:
python -m pytest tests/test_list_command.py
"""
import asyncio

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from models.battlemap import Battlemap, BattlemapMetadata
from models.encounter import Encounter, EncounterMetadata
from routes.auth import require_auth
from routes.doc_router import make_doc_router
from services import doc_commands, sync_hub
from services.doc_backend import LocalDocBackend
from services.doc_collection import DocCollection
from services.doc_type import DocType
from services.sync_hub import DocHub

ENCOUNTER = DocType(
    kind="encounter", prefix="encounters",
    model=Encounter, metadata_model=EncounterMetadata, items_key="encounters",
    live=True, collections=("combatants",), patchable=("name", "description"),
)
BATTLEMAP = DocType(
    kind="battlemap", prefix="battlemaps",
    model=Battlemap, metadata_model=BattlemapMetadata, items_key="battlemaps",
    live=True, collections=("tokens",), patchable=("name",),
)


def encounter_with(*conditions):
    return {"combatants": [{"id": "orc", "name": "Orc", "conditions": list(conditions)}]}


# ── the command ─────────────────────────────────────────────────────────────

def test_adds_and_removes_entities_by_id():
    doc = encounter_with({"id": "c1", "name": "Prone"})
    doc_commands.edit_list(doc, ENCOUNTER, "combatants", "orc", "conditions", [{"id": "c2", "name": "Poisoned"}], [])
    assert [c["id"] for c in doc["combatants"][0]["conditions"]] == ["c1", "c2"]
    doc_commands.edit_list(doc, ENCOUNTER, "combatants", "orc", "conditions", [], ["c1"])
    assert doc["combatants"][0]["conditions"] == [{"id": "c2", "name": "Poisoned"}]


def test_adding_what_is_there_or_removing_what_is_not_changes_nothing():
    doc = encounter_with({"id": "c1", "name": "Prone"})
    doc_commands.edit_list(doc, ENCOUNTER, "combatants", "orc", "conditions", [{"id": "c1", "name": "Other"}], ["ghost"])
    assert doc["combatants"][0]["conditions"] == [{"id": "c1", "name": "Prone"}]


def test_plain_values_are_a_set():
    doc = {"tokens": [{"id": "t1", "bars": ["HP"]}]}
    doc_commands.edit_list(doc, BATTLEMAP, "tokens", "t1", "bars", ["Fury", "HP"], [])
    assert doc["tokens"][0]["bars"] == ["HP", "Fury"]
    doc_commands.edit_list(doc, BATTLEMAP, "tokens", "t1", "bars", [], ["HP"])
    assert doc["tokens"][0]["bars"] == ["Fury"]


def test_a_missing_list_starts_empty():
    doc = {"tokens": [{"id": "t1"}]}
    doc_commands.edit_list(doc, BATTLEMAP, "tokens", "t1", "bars", ["HP"], [])
    assert doc["tokens"][0]["bars"] == ["HP"]


def test_only_a_list_of_a_known_entity():
    doc = encounter_with()
    doc["combatants"][0]["notes"] = "hi"
    with pytest.raises(ValueError, match="isn't a list"):
        doc_commands.edit_list(doc, ENCOUNTER, "combatants", "orc", "notes", ["x"], [])
    with pytest.raises(ValueError, match="Not found"):
        doc_commands.edit_list(doc, ENCOUNTER, "combatants", "ghost", "conditions", ["x"], [])
    with pytest.raises(ValueError, match="id"):
        doc_commands.edit_list(doc, ENCOUNTER, "combatants", "orc", "id", ["x"], [])


# ── through the hub and over HTTP ───────────────────────────────────────────

@pytest.fixture
def api(tmp_path, monkeypatch):
    monkeypatch.setattr(sync_hub, "FLUSH_DELAY", 0.05)
    backend = LocalDocBackend(tmp_path)
    encounters = DocCollection(ENCOUNTER, backend)
    battlemaps = DocCollection(BATTLEMAP, backend)
    encounters.create("Fight")
    battlemaps.create("Cave")
    hub = DocHub({"encounter": encounters, "battlemap": battlemaps})
    app = FastAPI()
    app.include_router(make_doc_router(ENCOUNTER, encounters, hub, viewer=lambda request, doc_id: None))
    app.include_router(make_doc_router(BATTLEMAP, battlemaps, hub, viewer=lambda request, doc_id: None))
    app.dependency_overrides[require_auth] = lambda: {"email": "gm@example.com", "name": "GM"}
    with TestClient(app) as client:
        yield client, hub


def test_two_conditions_added_at_once_are_both_kept(api):
    client, hub = api
    client.post("/api/encounters/fight/combatants", json={"items": [{"id": "orc", "name": "Orc"}]})

    async def both():
        # Two players, each adding a condition to what they saw: none.
        await asyncio.gather(
            hub.mutate("encounter", "fight", lambda d: doc_commands.edit_list(
                d, ENCOUNTER, "combatants", "orc", "conditions", [{"id": "a", "name": "Prone"}], [])),
            hub.mutate("encounter", "fight", lambda d: doc_commands.edit_list(
                d, ENCOUNTER, "combatants", "orc", "conditions", [{"id": "b", "name": "Dazed"}], [])),
        )
    client.portal.call(both)
    snapshot = client.get("/api/encounters/fight").json()
    assert [c["name"] for c in snapshot["combatants"][0]["conditions"]] == ["Prone", "Dazed"]


def test_the_list_command_over_http(api):
    client, _ = api
    client.post("/api/encounters/fight/combatants", json={"items": [{"id": "orc", "name": "Orc"}]})
    event = client.post(
        "/api/encounters/fight/combatants/orc/list", json={"field": "conditions", "add": [{"id": "c1", "name": "Prone"}]},
    ).json()
    assert [(c["id"], c["name"]) for c in event["upsert"]["combatants"][0]["conditions"]] == [("c1", "Prone")]
    client.post("/api/encounters/fight/combatants/orc/list", json={"field": "conditions", "remove": ["c1"]})
    assert client.get("/api/encounters/fight").json()["combatants"][0]["conditions"] == []

    client.post("/api/battlemaps/cave/tokens", json={"items": [{"id": "t1", "name": "Orc"}]})
    client.post("/api/battlemaps/cave/tokens/t1/list", json={"field": "bars", "add": ["HP", "Fury"]})
    assert client.get("/api/battlemaps/cave").json()["tokens"][0]["bars"] == ["HP", "Fury"]


def test_the_model_still_has_the_last_word(api):
    client, _ = api
    client.post("/api/encounters/fight/combatants", json={"items": [{"id": "orc", "name": "Orc"}]})
    # A condition needs a name; a token has at most 8 bars.
    bad = client.post("/api/encounters/fight/combatants/orc/list", json={"field": "conditions", "add": [{"id": "c1"}]})
    assert bad.status_code == 400
    assert client.post("/api/encounters/fight/combatants/orc/list", json={"field": "notes", "add": ["x"]}).status_code == 400
    assert client.post("/api/encounters/fight/combatants/ghost/list", json={"field": "conditions"}).status_code == 400
    assert client.post("/api/encounters/fight/combatants/orc/list", json={"field": ""}).status_code == 422
    client.post("/api/battlemaps/cave/tokens", json={"items": [{"id": "t1", "name": "Orc"}]})
    too_many = client.post("/api/battlemaps/cave/tokens/t1/list", json={"field": "bars", "add": [str(i) for i in range(9)]})
    assert too_many.status_code == 400
    assert client.get("/api/encounters/fight").json()["combatants"][0]["conditions"] == []
