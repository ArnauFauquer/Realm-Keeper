from pydantic import BaseModel
from typing import Optional


class LibraryFolder(BaseModel):
    id: str
    name: str
    parent_id: Optional[str] = None
    updated_at: Optional[str] = None


class LibraryAsset(BaseModel):
    id: str
    name: str
    image_url: Optional[str] = None
    folder_id: Optional[str] = None
    updated_at: Optional[str] = None
