from typing import Dict, Optional

from pydantic import BaseModel, ConfigDict, Field

from models.encounter import ResourceState

# A character's id is its sheet's id: lowercase letters, digits and hyphens
# (services/sheet_parser.py slugify), never a folder path.
CHARACTER_ID_PATTERN = r"^[a-z0-9]+(?:-[a-z0-9]+)*$"


class CharacterMetadata(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    name: str = Field("", max_length=120)
    description: Optional[str] = Field(None, max_length=2000)
    updated_at: Optional[str] = None


class Character(CharacterMetadata):
    """What is saved about one `character` sheet between sessions: its current
    counters, under the sheet's id, so the same values show on its note and in
    every encounter and map it takes part in. One document per character. The
    counters' definitions (max, min, colour) are copied from the sheet when the
    character is first saved and brought up to date when the sheet changes;
    `name` is the sheet's, kept so the saved characters can be told apart
    without their notes (or after a note is gone)."""
    model_config = ConfigDict(extra="allow")

    schema_version: int = 2
    rev: int = 0
    resources: Dict[str, ResourceState] = Field(default_factory=dict, max_length=24)
