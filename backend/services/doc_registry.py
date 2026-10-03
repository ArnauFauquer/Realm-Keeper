"""The kinds of document the app stores, and the one place that holds them:
the backend they live in, a collection per kind, and the hub that serves the
live ones."""
from models.battlemap import Battlemap, BattlemapMetadata
from models.characters import CHARACTERS_DOC_ID, CharactersDoc, CharactersMetadata
from models.encounter import Encounter, EncounterMetadata
from services.doc_backend import default_doc_backend
from services.doc_collection import DocCollection
from services.doc_type import DocType
from services.sync_hub import DocHub

ENCOUNTER = DocType(
    kind="encounter", prefix="encounters", item_filename="encounter.json",
    model=Encounter, metadata_model=EncounterMetadata, items_key="encounters",
    image_fields=("combatants[].image_url",),
    live=True, collections=("combatants",), patchable=("name", "description"),
)

BATTLEMAP = DocType(
    kind="battlemap", prefix="battlemaps", item_filename="battlemap.json",
    model=Battlemap, metadata_model=BattlemapMetadata, items_key="battlemaps",
    image_fields=("image_url", "tokens[].image_url"),
    live=True, collections=("tokens",), patchable=("name", "description", "image_url", "grid", "encounter"),
)

# The saved state of every `character` sheet: one document, there is no list of them.
CHARACTERS = DocType(
    kind="characters", prefix="characters", item_filename="characters.json",
    model=CharactersDoc, metadata_model=CharactersMetadata, items_key="characters",
    live=True, collections=("characters",), singleton=CHARACTERS_DOC_ID,
)

doc_backend = default_doc_backend()
encounter_collection = DocCollection(ENCOUNTER, doc_backend)
characters_collection = DocCollection(CHARACTERS, doc_backend)
battlemap_collection = DocCollection(BATTLEMAP, doc_backend)

hub = DocHub({
    ENCOUNTER.kind: encounter_collection,
    CHARACTERS.kind: characters_collection,
    BATTLEMAP.kind: battlemap_collection,
})
