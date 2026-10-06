from typing import Annotated, Any, Dict, List, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, StrictFloat, StrictInt, model_validator

# What an encounter's copy of a counter (and a character's saved value per
# counter) may be: a sheet with more, or longer, couldn't be played.
from models.encounter import MAX_COUNTER_COLOR_LENGTH, MAX_COUNTERS

SheetType = Literal["character", "adversary"]


class ResourceSpec(BaseModel):
    """A counter on a sheet: HP, Stress, Sanity, Hope... — the name is the
    author's, nothing here knows what it means. `start` is the value the
    counter begins at (the maximum when omitted), so a resource may as well
    count up from 0 as down from `max`. A sheet's counters are written in its
    sections (`counters`); their names are unique in the sheet."""
    max: int
    min: int = 0
    start: Optional[int] = None
    color: Optional[str] = None
    style: Optional[str] = None


class StatSpec(BaseModel):
    label: str
    value: Any = None
    roll: Optional[str] = None


class StatGroup(BaseModel):
    """Stats shown together; `columns` fixes how many go in a row."""
    title: Optional[str] = None
    columns: Optional[int] = None
    stats: List[StatSpec] = []


class SheetItem(BaseModel):
    name: Optional[str] = None
    text: Optional[str] = None
    roll: Optional[str] = None
    tags: List[str] = []
    cost: Optional[str] = None


class SheetSection(BaseModel):
    """A block of the sheet: its counters (by name: the specs are in
    SheetSpec.resources), stats and items, in that order. `columns` lays its
    items out in a grid; `wide` takes the whole row when the sheet's sections
    are in columns; `collapsed` starts it folded; sections sharing a `tab` are
    shown together under that tab."""
    title: Optional[str] = None
    columns: Optional[int] = None
    wide: bool = False
    collapsed: bool = False
    tab: Optional[str] = None
    counters: List[str] = []
    stats: List[StatGroup] = []
    items: List[SheetItem] = []


class SheetSpec(BaseModel):
    """A sheet as it is drawn and played: its document's name, id and type,
    and its counters gathered by name into `resources` (each section names
    its own). Made from a document's SheetBody (spec_from_body), or from the
    YAML sheets used to be written in. `character` is an individual whose
    current values persist; `adversary` is a template instantiated per
    encounter."""
    id: str
    name: str
    type: SheetType = "adversary"
    subtitle: Optional[str] = None
    image: Optional[str] = None
    tags: List[str] = []
    resources: Dict[str, ResourceSpec] = {}
    stats: List[StatGroup] = []
    sections: List[SheetSection] = []
    columns: Optional[int] = None
    text: Optional[str] = None


# ── The sheet as a document stores it ───────────────────────────────────
# A character's or an adversary's `sheet`: what the sheet builder edits, as
# JSON. SheetSpec above is what it draws, derived from it
# (services/sheet_parser.py spec_from_body, utils/sheet.js sheetFromDoc).

MAX_COLUMNS = 12
ShortText = Annotated[str, Field(max_length=200)]
LongText = Annotated[str, Field(max_length=20_000)]
Columns = Annotated[int, Field(ge=1, le=MAX_COLUMNS)]


class SheetCounter(BaseModel):
    """A counter, named: the name is the key its saved values go by."""
    name: Annotated[str, Field(min_length=1, max_length=80)]
    max: int
    min: int = 0
    start: Optional[int] = None
    color: Optional[Annotated[str, Field(max_length=MAX_COUNTER_COLOR_LENGTH)]] = None
    style: Optional[Literal["pips", "bar", "number"]] = None

    @model_validator(mode="after")
    def _range(self):
        if self.min > self.max:
            raise ValueError(f"counter '{self.name}' has a min above its max")
        return self


class BodyStat(BaseModel):
    label: Annotated[str, Field(min_length=1, max_length=200)]
    value: Union[StrictInt, StrictFloat, ShortText, None] = None
    roll: Optional[ShortText] = None


class BodyStatGroup(BaseModel):
    title: Optional[ShortText] = None
    columns: Optional[Columns] = None
    stats: List[BodyStat] = Field(default_factory=list, max_length=200)


class BodyItem(BaseModel):
    name: Optional[ShortText] = None
    text: Optional[LongText] = None
    roll: Optional[ShortText] = None
    tags: List[Annotated[str, Field(max_length=80)]] = Field(default_factory=list, max_length=30)
    cost: Optional[ShortText] = None


class BodySection(BaseModel):
    title: Optional[ShortText] = None
    columns: Optional[Columns] = None
    wide: bool = False
    collapsed: bool = False
    tab: Optional[Annotated[str, Field(max_length=80)]] = None
    counters: List[SheetCounter] = Field(default_factory=list, max_length=MAX_COUNTERS)
    stats: List[BodyStatGroup] = Field(default_factory=list, max_length=50)
    items: List[BodyItem] = Field(default_factory=list, max_length=200)


class SheetBody(BaseModel):
    """A sheet: its header (subtitle, portrait, tags), its sections in order,
    and a closing text. Sections hold counters, groups of stats and entries.
    Its name, id and type are its document's."""
    model_config = ConfigDict(extra="forbid")

    subtitle: Optional[Annotated[str, Field(max_length=300)]] = None
    image: Optional[Annotated[str, Field(max_length=1000)]] = None
    tags: List[Annotated[str, Field(max_length=80)]] = Field(default_factory=list, max_length=50)
    columns: Optional[Columns] = None
    text: Optional[LongText] = None
    sections: List[BodySection] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def _unique_counters(self):
        names = [counter.name for section in self.sections for counter in section.counters]
        if len(names) > MAX_COUNTERS:
            raise ValueError(f"a sheet can have at most {MAX_COUNTERS} counters")
        seen = set()
        for name in names:
            if name in seen:
                raise ValueError(f"two counters are called '{name}': counter names must be unique in a sheet")
            seen.add(name)
        return self


class SheetCatalogEntry(BaseModel):
    """One sheet of the catalog: a character or an adversary document, read.
    `ref` is the document's id (unique within its type)."""
    ref: str
    type: SheetType
    sheet: SheetSpec
    warnings: List[str] = []


class SheetSummary(BaseModel):
    """A catalog entry without its body, for listings and pickers. `folder` is
    where the document is kept in its gallery."""
    ref: str
    id: str
    name: str
    type: SheetType
    subtitle: Optional[str] = None
    image: Optional[str] = None
    tags: List[str] = []
    resources: Dict[str, ResourceSpec] = {}
    folder: str = ""
    warnings: List[str] = []
