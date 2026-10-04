from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field

from services.sheet_parser import MAX_SOURCE_LENGTH


class SheetDocMetadata(BaseModel):
    """What a gallery (and the sheet catalog) needs of a character or an
    adversary. `image`, `subtitle` and `tags` are read from its source when it
    is stored, so a listing doesn't parse every sheet."""
    id: str
    name: str = Field("", max_length=120)
    description: Optional[str] = Field(None, max_length=2000)
    image: Optional[str] = Field(None, max_length=1000)
    subtitle: Optional[str] = Field(None, max_length=300)
    tags: List[str] = Field(default_factory=list, max_length=50)
    updated_at: Optional[str] = None


class SheetDoc(SheetDocMetadata):
    """A sheet kept as a document: its YAML (`source`, the same format a sheet
    always had, without `name`, `id` and `type`, which are the document's),
    edited in its gallery and shown in notes as `character:<id>` or
    `adversary:<id>`. The sheet itself is parsed from `source` where it is
    used (services/sheet_parser.py parse_sheet_doc, utils/sheet.js)."""
    model_config = ConfigDict(extra="allow")

    source: str = Field("", max_length=MAX_SOURCE_LENGTH)
