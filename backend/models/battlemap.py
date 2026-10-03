from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator

MAX_TOKENS = 500
# Positions are in cells; far outside any map, but a bound all the same.
MAX_COORD = 100_000


class Grid(BaseModel):
    """How the map is divided. `size` is a cell's side in pixels of the map
    image; tokens are placed and sized in cells, so changing it doesn't move
    anyone. What a cell is worth (5 ft, 1.5 m, 1 square) is up to the table:
    `distance` and `unit`, which the ruler multiplies by."""
    model_config = ConfigDict(extra="allow")

    type: Literal["square", "none"] = "square"
    size: float = Field(70, ge=4, le=2000)
    offset_x: float = Field(0, ge=-MAX_COORD, le=MAX_COORD)
    offset_y: float = Field(0, ge=-MAX_COORD, le=MAX_COORD)
    snap: bool = True
    visible: bool = True
    color: str = Field("#ffffff", max_length=40)
    opacity: float = Field(0.25, ge=0, le=1)
    distance: float = Field(1, gt=0, le=1_000_000)
    unit: str = Field("cell", max_length=20)
    # "grid": count cells, a diagonal step is one cell (the usual on a square
    # grid); "straight": the length of the line.
    measure: Literal["grid", "straight"] = "grid"


class Token(BaseModel):
    """Something on the map. `x`, `y` are the corner of the cell it stands on
    (its top left), in cells. A token may stand for a combatant of the map's
    encounter: it then shows that combatant's counters (`bars` says which)."""
    model_config = ConfigDict(extra="allow")

    id: str = Field(min_length=1, max_length=64)
    name: str = Field("", max_length=120)
    x: float = Field(0, ge=-MAX_COORD, le=MAX_COORD)
    y: float = Field(0, ge=-MAX_COORD, le=MAX_COORD)
    size: float = Field(1, gt=0, le=50)
    rotation: float = Field(0, ge=-3600, le=3600)
    image_url: Optional[str] = Field(None, max_length=1000)
    color: Optional[str] = Field(None, max_length=40)
    # Hidden tokens are not shown on a screen (see services/battlemap_projection.py).
    hidden: bool = False
    sheet: Optional[str] = Field(None, max_length=300)
    combatant: Optional[str] = Field(None, max_length=64)
    show_bars: bool = False
    bars: List[str] = Field(default_factory=list, max_length=8)


class BattlemapMetadata(BaseModel):
    id: str
    name: str = Field(max_length=120)
    description: Optional[str] = Field(None, max_length=2000)
    image_url: Optional[str] = Field(None, max_length=1000)
    updated_at: Optional[str] = None


class Battlemap(BattlemapMetadata):
    model_config = ConfigDict(extra="allow")

    schema_version: int = 1
    rev: int = 0
    grid: Grid = Field(default_factory=Grid)
    # The encounter whose combatants this map's tokens may stand for.
    encounter: Optional[str] = Field(None, max_length=300)
    tokens: List[Token] = Field(default_factory=list, max_length=MAX_TOKENS)

    @model_validator(mode="after")
    def _unique_token_ids(self):
        ids = [t.id for t in self.tokens]
        if len(set(ids)) != len(ids):
            raise ValueError("token ids must be unique")
        return self
