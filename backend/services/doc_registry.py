"""The kinds of document the app stores, and the one place that holds them:
the backend they live in, a collection per kind, the Observatory (the tree of
folders they share with the images) and the hub that serves the live ones.
Notes are the only thing that lives elsewhere (in git)."""
import logging
from pathlib import Path

from models.adversary import Adversary
from models.battlemap import Battlemap, BattlemapMetadata
from models.characters import Character
from models.chart import Chart, ChartMetadata
from models.encounter import Encounter, EncounterMetadata
from models.sheet_doc import SheetDocMetadata
from models.vista import Vista, VistaMetadata
from services.doc_backend import default_doc_backend
from services.doc_collection import DocCollection
from services.doc_type import DocType
from services.observatory import Observatory
from services.sheet_docs import sheet_preparer
from services.sync_hub import DocHub

logger = logging.getLogger(__name__)

# A chart is a map with pins, paths and notes; a vista is a scene staged for the
# table screen. Edited whole and saved, not live: see `live` in DocType.
CHART = DocType(
    kind="chart", prefix="charts",
    model=Chart, metadata_model=ChartMetadata, items_key="charts",
    locked_fields=("image_url",), asset_routes={"image": "image_url"},
    image_fields=("image_url", "pins[].icon_url"),
    legacy_dir="_charts",
)

VISTA = DocType(
    kind="vista", prefix="vistas",
    model=Vista, metadata_model=VistaMetadata, items_key="vistas",
    locked_fields=("background_url",), asset_routes={"background": "background_url"},
    image_fields=("background_url", "assets[].image_url"),
    legacy_dir="_vistas",
)

ENCOUNTER = DocType(
    kind="encounter", prefix="encounters",
    model=Encounter, metadata_model=EncounterMetadata, items_key="encounters",
    image_fields=("combatants[].image_url",),
    live=True, collections=("combatants",), patchable=("name", "description"),
)

BATTLEMAP = DocType(
    kind="battlemap", prefix="battlemaps",
    model=Battlemap, metadata_model=BattlemapMetadata, items_key="battlemaps",
    image_fields=("image_url", "tokens[].image_url"),
    live=True, collections=("tokens",), patchable=("name", "description", "image_url", "grid", "encounter"),
)

# Sheets: a character is an individual whose counters are played live, the
# same on every note and in every encounter and map; an adversary is a template,
# copied into an encounter each time it is added. Both are their sheet's YAML
# (`source`); see models/sheet_doc.py.
CHARACTER = DocType(
    kind="character", prefix="characters",
    model=Character, metadata_model=SheetDocMetadata, items_key="characters",
    live=True, patchable=("name", "description", "source"), resources_field="resources",
    prepare=sheet_preparer("character"),
)

ADVERSARY = DocType(
    kind="adversary", prefix="adversaries",
    model=Adversary, metadata_model=SheetDocMetadata, items_key="adversaries",
    prepare=sheet_preparer("adversary"),
)

doc_backend = default_doc_backend()
chart_collection = DocCollection(CHART, doc_backend)
vista_collection = DocCollection(VISTA, doc_backend)
encounter_collection = DocCollection(ENCOUNTER, doc_backend)
characters_collection = DocCollection(CHARACTER, doc_backend)
adversary_collection = DocCollection(ADVERSARY, doc_backend)
battlemap_collection = DocCollection(BATTLEMAP, doc_backend)

observatory = Observatory(doc_backend, {
    collection.doctype.kind: collection
    for collection in (
        chart_collection, vista_collection, encounter_collection, battlemap_collection,
        characters_collection, adversary_collection,
    )
})

hub = DocHub({
    ENCOUNTER.kind: encounter_collection,
    CHARACTER.kind: characters_collection,
    BATTLEMAP.kind: battlemap_collection,
})


def import_legacy_documents(vault_path: Path) -> None:
    """Brings in the charts and vistas that were kept in the vault, if that has
    not been done: see DocCollection.import_legacy. A failure (storage down) is
    logged and tried again at the next start, not fatal: the notes still work."""
    for collection in (chart_collection, vista_collection):
        try:
            collection.import_legacy(vault_path)
        except Exception:
            logger.exception(f"Could not import the {collection.doctype.prefix} from the vault")
