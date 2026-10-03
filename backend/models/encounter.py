from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator

MAX_COMBATANTS = 200


class ResourceState(BaseModel):
    """A live counter: HP, Stress, Sanity... named by whoever wrote the sheet.
    `current` may sit anywhere between `min` and `max`; where it starts, and
    which way is good, is the sheet's business, not this model's."""
    model_config = ConfigDict(extra="allow")

    current: int
    max: int
    min: int = 0
    color: Optional[str] = Field(None, max_length=40)
    style: Optional[str] = Field(None, max_length=20)

    @model_validator(mode="after")
    def _min_below_max(self):
        if self.min > self.max:
            raise ValueError("a resource's min is above its max")
        return self


class Condition(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str = Field(min_length=1, max_length=64)
    name: str = Field(max_length=80)
    value: Optional[int] = None


class Combatant(BaseModel):
    """Someone in an encounter. An `adversary` is an instance of a template:
    it carries its own counters, copied from the sheet when it was added. A
    `character` is the individual itself: its counters live with the character
    (models/characters.py), so what changes here shows on its sheet too."""
    model_config = ConfigDict(extra="allow")

    id: str = Field(min_length=1, max_length=64)
    name: str = Field(max_length=120)
    type: Literal["character", "adversary"] = "adversary"
    sheet: Optional[str] = Field(None, max_length=300)
    initiative: Optional[float] = None
    resources: Dict[str, ResourceState] = Field(default_factory=dict, max_length=24)
    conditions: List[Condition] = Field(default_factory=list, max_length=24)
    notes: str = Field("", max_length=4000)
    defeated: bool = False
    image_url: Optional[str] = Field(None, max_length=1000)

    @model_validator(mode="after")
    def _character_has_a_sheet_and_no_counters(self):
        if self.type == "character":
            if not self.sheet:
                raise ValueError("a character combatant needs its sheet")
            if self.resources:
                raise ValueError("a character's counters belong to the character, not to the encounter")
        return self


class EncounterMetadata(BaseModel):
    id: str
    name: str = Field(max_length=120)
    description: Optional[str] = Field(None, max_length=2000)
    updated_at: Optional[str] = None


class Encounter(EncounterMetadata):
    model_config = ConfigDict(extra="allow")

    schema_version: int = 1
    rev: int = 0
    round: int = Field(0, ge=0)
    turn: Optional[str] = None
    combatants: List[Combatant] = Field(default_factory=list, max_length=MAX_COMBATANTS)

    @model_validator(mode="after")
    def _consistent(self):
        ids = [c.id for c in self.combatants]
        if len(set(ids)) != len(ids):
            raise ValueError("combatant ids must be unique")
        sheets = [c.sheet for c in self.combatants if c.type == "character"]
        if len(set(sheets)) != len(sheets):
            raise ValueError("a character can be in an encounter only once")
        if self.turn not in ids:
            self.turn = None
        return self
