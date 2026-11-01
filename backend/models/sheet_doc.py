from typing import Any, ClassVar, List, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator

from models.sheet import SheetBody


class SheetDocMetadata(BaseModel):
    """What a gallery (and the sheet catalog) needs of a character or an
    adversary. `image`, `subtitle` and `tags` are copied from its sheet when it
    is stored, so a listing doesn't read every sheet."""
    id: str
    name: str = Field("", max_length=120)
    description: Optional[str] = Field(None, max_length=2000)
    image: Optional[str] = Field(None, max_length=1000)
    subtitle: Optional[str] = Field(None, max_length=300)
    tags: List[str] = Field(default_factory=list, max_length=50)
    updated_at: Optional[str] = None


class SheetDoc(SheetDocMetadata):
    """A sheet kept as a document: the sheet itself (`sheet`, JSON, built in
    its gallery's sheet builder), shown in notes as `character:<id>` or
    `adversary:<id>`. Its name, id and type are the document's.

    A document stored when sheets were YAML has a `source` instead; it becomes
    a `sheet` when read (services/sheet_parser.py upgrade_legacy_source; the
    stored ones are converted at startup, services/sheet_import.py)."""
    model_config = ConfigDict(extra="allow")
    sheet_type: ClassVar[str] = "adversary"

    sheet: SheetBody = Field(default_factory=SheetBody)

    @model_validator(mode="before")
    @classmethod
    def _from_yaml(cls, data: Any) -> Any:
        if isinstance(data, dict) and "source" in data:
            from services.sheet_parser import upgrade_legacy_source  # the parser imports the models
            data = dict(data)
            upgrade_legacy_source(data, cls.sheet_type)
        return data
