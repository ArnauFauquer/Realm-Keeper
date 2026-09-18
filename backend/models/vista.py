from pydantic import BaseModel
from typing import List, Optional


class VanishingPoint(BaseModel):
    x: float = 50.0
    y: float = 40.0


class VistaAsset(BaseModel):
    id: str
    name: str
    image_url: Optional[str] = None
    # x/y are percentages of the canvas, with (x, y) the asset's foot/anchor
    # point. There is no separate "depth" field: how far away (and thus how
    # small) an asset appears is derived at render time from how close y is
    # to the vanishing point's y versus the bottom of the stage — moving an
    # asset up toward the vanishing point is what makes it recede.
    x: float = 50.0
    y: float = 70.0
    # Base width, as a percentage of the canvas width, when standing at the
    # closest possible point (y = 100, the bottom edge of the stage).
    width_pct: float = 20.0
    flip_h: bool = False


class VistaMetadata(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    background_url: Optional[str] = None
    updated_at: Optional[str] = None


class Vista(VistaMetadata):
    vanishing_point: VanishingPoint = VanishingPoint()
    assets: List[VistaAsset] = []
