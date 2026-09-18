from pydantic import BaseModel
from typing import List, Literal, Optional


class Pin(BaseModel):
    id: str
    x: float
    y: float
    name: str
    icon_url: Optional[str] = None
    note_path: Optional[str] = None


class PathPoint(BaseModel):
    x: float
    y: float


class ChartPath(BaseModel):
    id: str
    points: List[PathPoint]
    direction: Literal["forward", "reverse", "none"] = "forward"
    color: Optional[str] = None


class Annotation(BaseModel):
    id: str
    x: float
    y: float
    text: str
    scale: Optional[float] = 1.0


class ChartMetadata(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    image_url: Optional[str] = None
    updated_at: Optional[str] = None


class Chart(ChartMetadata):
    pins: List[Pin] = []
    paths: List[ChartPath] = []
    annotations: List[Annotation] = []
