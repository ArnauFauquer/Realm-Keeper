from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel

SheetType = Literal["character", "adversary"]


class ResourceSpec(BaseModel):
    """A counter on a sheet: HP, Stress, Sanity, Hope... — the name is the
    author's, nothing here knows what it means. `start` is the value the
    counter begins at (the maximum when omitted), so a resource may as well
    count up from 0 as down from `max`. `group` only gathers counters under a
    heading on the sheet."""
    max: int
    min: int = 0
    start: Optional[int] = None
    color: Optional[str] = None
    style: Optional[str] = None
    group: Optional[str] = None


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
    """`columns` lays its items out in a grid; `wide` takes the whole row when
    the sheet's sections are in columns; `collapsed` starts it folded."""
    title: Optional[str] = None
    columns: Optional[int] = None
    wide: bool = False
    collapsed: bool = False
    items: List[SheetItem] = []


class SheetSpec(BaseModel):
    """What a ```sheet block in a note describes, normalized (shorthands
    expanded, defaults filled). `character` is an individual whose current
    values persist; `adversary` is a template instantiated per encounter."""
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


class SheetCatalogEntry(BaseModel):
    """One sheet found in the vault. `ref` identifies it: a character by its
    global id (so moving or renaming the note never loses its saved state);
    an adversary as "<note id>#<sheet id>"."""
    ref: str
    note_id: str
    note_title: str
    sheet: SheetSpec
    warnings: List[str] = []


class SheetSummary(BaseModel):
    """A catalog entry without its body, for listings and pickers."""
    ref: str
    id: str
    name: str
    type: SheetType
    subtitle: Optional[str] = None
    image: Optional[str] = None
    tags: List[str] = []
    resources: Dict[str, ResourceSpec] = {}
    note_id: str
    note_title: str
    warnings: List[str] = []
