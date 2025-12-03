from pydantic import BaseModel
from typing import Optional, List, Dict


class Note(BaseModel):
    """Modelo para una nota de Markdown"""
    id: str  # Path relativo desde el root del vault
    title: str
    path: str  # Path completo incluyendo directorios
    content: str
    frontmatter: Optional[Dict] = None
    tags: List[str] = []
    links: List[str] = []  # Wikilinks encontrados en la nota


class NoteMetadata(BaseModel):
    """Metadata ligera para listar notas"""
    id: str
    title: str
    path: str
    tags: List[str] = []
    type: Optional[str] = None
