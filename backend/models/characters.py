from typing import Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator

from models.encounter import ResourceState

CHARACTERS_DOC_ID = "all"


class CharacterState(BaseModel):
    """What is saved about one `character` sheet between sessions: its current
    counters, kept under the sheet's id so the same values show on its note and
    in every encounter and map it takes part in. The counters' definitions
    (max, min, colour) are copied from the sheet when the state is created and
    brought up to date when the sheet changes."""
    model_config = ConfigDict(extra="allow")

    id: str = Field(min_length=1, max_length=64)
    resources: Dict[str, ResourceState] = Field(default_factory=dict, max_length=24)


class CharactersMetadata(BaseModel):
    id: str
    name: str = "Characters"
    description: Optional[str] = None
    updated_at: Optional[str] = None


class CharactersDoc(CharactersMetadata):
    """The state of every character, in a single document: a table has a
    handful of them, and one document means one subscription and one write."""
    model_config = ConfigDict(extra="allow")

    schema_version: int = 1
    rev: int = 0
    characters: List[CharacterState] = Field(default_factory=list, max_length=500)

    @model_validator(mode="after")
    def _unique_ids(self):
        ids = [c.id for c in self.characters]
        if len(set(ids)) != len(ids):
            raise ValueError("character ids must be unique")
        return self
