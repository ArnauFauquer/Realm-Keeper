from pydantic import BaseModel
from typing import Optional, List, Dict

class Note(BaseModel):
    id: str
    title: str
    path: str
    content: str
    frontmatter: Optional[Dict] = None
    tags: List[str] = []
    links: List[str] = []

class NoteMetadata(BaseModel):
    id: str
    title: str
    path: str
    tags: List[str] = []
    type: Optional[str] = None
