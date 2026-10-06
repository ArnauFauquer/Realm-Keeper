from typing import ClassVar, Dict

from pydantic import Field

from models.encounter import MAX_COUNTERS, ResourceState
from models.sheet_doc import SheetDoc


class Character(SheetDoc):
    """An individual (a player character, a recurring NPC): its sheet, and the
    current value of each of its counters, the same on every note that shows
    it and in every encounter and map it takes part in. A live document: the
    counters change as they are played (services/sync_hub.py).

    `resources` follows the sheet: services/sheet_docs.py fits it to the
    counters the sheet declares whenever the character is stored."""
    sheet_type: ClassVar[str] = "character"
    schema_version: int = 3
    rev: int = 0
    resources: Dict[str, ResourceState] = Field(default_factory=dict, max_length=MAX_COUNTERS)
