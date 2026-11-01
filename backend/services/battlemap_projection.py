"""What a screen is shown of a battlemap.

A screen is the table's public view (a TV, a projector): it holds no login,
and everyone in the room can read it. So what reaches it is built here, from
the map, its encounter and the characters' saved values, and leaves out
anything the table keeps to itself: tokens and areas marked `hidden`, which sheet or
combatant a token stands for, and the counters it doesn't show. The server
does this before sending, never the screen after receiving.
"""
from typing import Any, Dict, List, Optional

PUBLIC_GRID_FIELDS = ("type", "size", "offset_x", "offset_y", "visible", "color", "opacity", "distance", "unit", "measure", "bands")
PUBLIC_AREA_FIELDS = ("id", "shape", "x", "y", "size", "angle", "spread", "width", "color", "label")


def _meters(token: Dict[str, Any], combatant: Optional[Dict[str, Any]], saved: Dict[str, Dict[str, Any]]) -> List[Dict[str, Any]]:
    """The counters a token shows (`bars`), from whoever it stands for: an
    adversary's own, or a character's saved ones."""
    if not token.get("show_bars") or combatant is None:
        return []
    if combatant.get("type") == "character":
        resources = (saved.get(combatant.get("sheet")) or {}).get("resources") or {}
    else:
        resources = combatant.get("resources") or {}
    meters = []
    for name in token.get("bars") or []:
        counter = resources.get(name)
        if counter:
            meters.append({
                "name": name, "current": counter["current"], "max": counter["max"],
                "min": counter.get("min", 0), "color": counter.get("color"), "style": counter.get("style"),
            })
    return meters


def project_for_screen(
    battlemap: Dict[str, Any], encounter: Optional[Dict[str, Any]] = None,
    characters: Optional[Dict[str, Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """`characters`: the saved values of the encounter's characters, by id."""
    combatants = {c["id"]: c for c in (encounter or {}).get("combatants", [])}
    saved = characters or {}
    tokens = [
        {
            "id": token["id"], "name": token.get("name", ""), "x": token["x"], "y": token["y"],
            "size": token.get("size", 1), "rotation": token.get("rotation", 0),
            "image_url": token.get("image_url"), "color": token.get("color"),
            "image_scale": token.get("image_scale", 1), "image_x": token.get("image_x", 0), "image_y": token.get("image_y", 0),
            "meters": _meters(token, combatants.get(token.get("combatant")), saved),
        }
        for token in battlemap.get("tokens", [])
        if not token.get("hidden")
    ]
    grid = battlemap.get("grid") or {}
    return {
        "battlemap_id": battlemap["id"],
        "name": battlemap.get("name", ""),
        "image_url": battlemap.get("image_url"),
        "grid": {field: grid[field] for field in PUBLIC_GRID_FIELDS if field in grid},
        "tokens": tokens,
        "areas": [
            {field: area[field] for field in PUBLIC_AREA_FIELDS if field in area}
            for area in battlemap.get("areas", [])
            if not area.get("hidden")
        ],
    }
