"""The kinds of document the app stores, and the one place that holds them:
the backend they live in, a collection per kind, and the hub that serves the
live ones. Notes are the only thing that lives elsewhere (in git)."""
import logging
from pathlib import Path

from models.battlemap import Battlemap, BattlemapMetadata
from models.characters import CHARACTERS_DOC_ID, CharactersDoc, CharactersMetadata
from models.chart import Chart, ChartMetadata
from models.encounter import Encounter, EncounterMetadata
from models.vista import Vista, VistaMetadata
from services.doc_backend import default_doc_backend
from services.doc_collection import DocCollection
from services.doc_type import DocType
from services.sync_hub import DocHub

logger = logging.getLogger(__name__)

# A chart is a map with pins, paths and notes; a vista is a scene staged for the
# table screen. Edited whole and saved, not live: see `live` in DocType.
CHART = DocType(
    kind="chart", prefix="charts", item_filename="chart.json",
    model=Chart, metadata_model=ChartMetadata, items_key="charts",
    locked_fields=("image_url",), asset_routes={"image": "image_url"},
    image_fields=("image_url", "pins[].icon_url"),
    legacy_dir="_charts",
)

VISTA = DocType(
    kind="vista", prefix="vistas", item_filename="vista.json",
    model=Vista, metadata_model=VistaMetadata, items_key="vistas",
    locked_fields=("background_url",), asset_routes={"background": "background_url"},
    image_fields=("background_url", "assets[].image_url"),
    legacy_dir="_vistas",
)

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
chart_collection = DocCollection(CHART, doc_backend)
vista_collection = DocCollection(VISTA, doc_backend)
encounter_collection = DocCollection(ENCOUNTER, doc_backend)
characters_collection = DocCollection(CHARACTERS, doc_backend)
battlemap_collection = DocCollection(BATTLEMAP, doc_backend)

hub = DocHub({
    ENCOUNTER.kind: encounter_collection,
    CHARACTERS.kind: characters_collection,
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
