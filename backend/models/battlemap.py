from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator

MAX_TOKENS = 500
MAX_AREAS = 100
MAX_BANDS = 12
# Positions are in cells; far outside any map, but a bound all the same.
MAX_COORD = 100_000


class RangeBand(BaseModel):
    """A named range ("Melee", "Close", "Far"...): anything up to `max` (in
    the grid's unit) is in it; the last one may have no `max` (anything
    further). The names and reaches are the table's: nothing here knows any."""
    name: str = Field(min_length=1, max_length=40)
    max: Optional[float] = Field(None, gt=0, le=1_000_000)


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
    # grid); "straight": the length of the line; "bands": the length of the
    # line, said as the range band it falls in (`bands`), for tables that
    # play by ranges rather than squares.
    measure: Literal["grid", "straight", "bands"] = "grid"
    bands: List[RangeBand] = Field(default_factory=list, max_length=MAX_BANDS)

    @model_validator(mode="after")
    def _bands_in_order(self):
        reaches = [band.max for band in self.bands]
        if None in reaches[:-1]:
            raise ValueError("only the last range band may reach without limit")
        bounded = [reach for reach in reaches if reach is not None]
        if bounded != sorted(set(bounded)):
            raise ValueError("range bands must reach further one after another")
        return self


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
    # How its image sits in it: zoomed (1 fills the token) and moved, in
    # token widths, so it can be framed on a face.
    image_scale: float = Field(1, ge=0.2, le=5)
    image_x: float = Field(0, ge=-1, le=1)
    image_y: float = Field(0, ge=-1, le=1)


class Area(BaseModel):
    """A shape laid on the map (a spell's reach, a zone, a hazard): from its
    origin `x`, `y` (cells), a `circle` of radius `size`, a `cone` of length
    `size` opening `spread` degrees, a `line` `size` long and `width` wide,
    or a `square` reaching `size` from its centre on every side. `angle` is
    where a cone or line points (degrees, clockwise from the right). Hidden
    ones are only for the table, like hidden tokens."""
    model_config = ConfigDict(extra="allow")

    id: str = Field(min_length=1, max_length=64)
    shape: Literal["circle", "cone", "line", "square"] = "circle"
    x: float = Field(0, ge=-MAX_COORD, le=MAX_COORD)
    y: float = Field(0, ge=-MAX_COORD, le=MAX_COORD)
    size: float = Field(1, gt=0, le=1000)
    angle: float = Field(0, ge=-3600, le=3600)
    spread: float = Field(60, ge=5, le=360)
    width: float = Field(1, gt=0, le=1000)
    color: Optional[str] = Field(None, max_length=40)
    label: str = Field("", max_length=60)
    hidden: bool = False


MAX_SIGNAL_POINTS = 64
# A pointer's stroke longer than this (in ms since it began) is drawn anyway,
# just as if it had begun again.
MAX_SIGNAL_TIME = 600_000


class SignalPoint(BaseModel):
    """A point of the map, in cells (like a token's x, y), and when it was
    pointed at: ms since its stroke began, so a stroke is replayed at the pace
    it was drawn."""
    x: float = Field(ge=-MAX_COORD, le=MAX_COORD)
    y: float = Field(ge=-MAX_COORD, le=MAX_COORD)
    t: float = Field(0, ge=0, le=MAX_SIGNAL_TIME)


class SignalRoll(BaseModel):
    """A roll made from the sheet of whoever a token stands for, as it is
    shown over the token: what for, the formula, the total."""
    label: str = Field("", max_length=80)
    formula: str = Field("", max_length=200)
    total: int = Field(ge=-1_000_000, le=1_000_000)


class MapSignal(BaseModel):
    """Something shown on a map for a moment, to everyone looking at it and on
    the screens, and kept nowhere: a `ping` at a point, the laser `pointer`
    (sent a few points at a time, as it moves: one `stroke` until `end`), a
    `roll` over a token, or a `ruler` (its whole path each time, origin,
    turns and end: one `stroke` until `end`; with a `token` when it is that
    token being moved). `source` tells the tab that sent it, so it can skip
    its own."""
    model_config = ConfigDict(extra="forbid")

    kind: Literal["ping", "pointer", "roll", "ruler"]
    points: List[SignalPoint] = Field(default_factory=list, max_length=MAX_SIGNAL_POINTS)
    stroke: Optional[str] = Field(None, max_length=40)
    end: bool = False
    token: Optional[str] = Field(None, max_length=64)
    roll: Optional[SignalRoll] = None
    source: str = Field("", max_length=40)

    @model_validator(mode="after")
    def _complete(self):
        if self.kind == "ping" and len(self.points) != 1:
            raise ValueError("a ping is one point")
        if self.kind in ("pointer", "ruler") and not self.stroke:
            raise ValueError(f"a {self.kind}'s points belong to a stroke")
        if self.kind == "roll" and (not self.token or self.roll is None):
            raise ValueError("a roll is shown over a token")
        return self


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
    areas: List[Area] = Field(default_factory=list, max_length=MAX_AREAS)

    @model_validator(mode="after")
    def _unique_ids(self):
        for name, entities in (("token", self.tokens), ("area", self.areas)):
            ids = [e.id for e in entities]
            if len(set(ids)) != len(ids):
                raise ValueError(f"{name} ids must be unique")
        return self
