"""What a paired screen (a TV, projector or OBS source with no login) may read.

Charts, vistas and the asset library require login. A screen instead holds a
screen key (see services/auth_service.create_screen_key), and that key only
unlocks whatever the GM is showing on the screens *right now*: the chart or
vista last sent, the images it's drawn from, or the single image sent with
"display media". Everything else stays behind login, and whatever a screen
could read stops being readable the moment the GM sends something else or
clears the screen.
"""
from typing import Optional, Set
from urllib.parse import unquote, urlsplit

from fastapi import HTTPException, Request

from routes.asset_library import ASSET_LIBRARY_URL_PREFIX
from routes.auth import current_user
from services.auth_service import SCREEN_COOKIE_NAME, verify_screen_key


def has_screen_key(cookies) -> bool:
    return verify_screen_key(cookies.get(SCREEN_COOKIE_NAME, ""))


def _current_state() -> dict:
    # Imported lazily: routes.screen and the chart/vista routes that call
    # into this module import each other's neighbours at load time.
    from routes.screen import manager
    return manager.current_state or {}


def asset_key_from_url(url: Optional[str]) -> Optional[str]:
    """The asset library key an image URL points at (relative or absolute,
    percent-encoded or not), or None if it isn't an asset library URL."""
    if not url:
        return None
    path = unquote(urlsplit(url).path)
    if not path.startswith(ASSET_LIBRARY_URL_PREFIX):
        return None
    return path[len(ASSET_LIBRARY_URL_PREFIX):]


def displayed_item(kind: str) -> Optional[str]:
    """Id of the chart/vista currently on screen, if that's what's showing."""
    state = _current_state()
    value = state.get(f"{kind}_id") if state.get("type") == f"display_{kind}" else None
    return value.strip("/") if isinstance(value, str) else None


def displayed_asset_keys() -> Set[str]:
    from routes.charts import chart_service_instance
    from routes.vistas import vista_service_instance

    state = _current_state()
    urls = []
    if state.get("type") == "display_media":
        urls.append(state.get("url"))
    elif (chart_id := displayed_item("chart")) and (chart := chart_service_instance.get_chart(chart_id)):
        urls.append(chart.image_url)
        urls.extend(pin.icon_url for pin in chart.pins)
    elif (vista_id := displayed_item("vista")) and (vista := vista_service_instance.get_vista(vista_id)):
        urls.append(vista.background_url)
        urls.extend(asset.image_url for asset in vista.assets)
    urls.extend(_live_draft_urls())
    return {key for key in map(asset_key_from_url, urls) if key}


def _live_draft_urls() -> list:
    """Images used by the GM's unsaved edits of what's on screen (routes/screen
    live updates): they may not be in the saved chart/vista yet."""
    from routes.screen import manager
    draft = manager.live_draft or {}
    if draft.get("type") == "update_chart" and displayed_item("chart") == draft.get("chart_id", "").strip("/"):
        return [draft.get("image_url"), *(p.get("icon_url") for p in draft.get("pins", []))]
    if draft.get("type") == "update_vista" and displayed_item("vista") == draft.get("vista_id", "").strip("/"):
        return [draft.get("background_url"), *(a.get("image_url") for a in draft.get("assets", []))]
    # What a battlemap's draft carries is already what a screen may see: hidden
    # tokens aren't in it, so neither are their images.
    if draft.get("type") == "update_battlemap" and displayed_item("battlemap") == draft.get("battlemap_id", "").strip("/"):
        return [draft.get("image_url"), *(t.get("image_url") for t in draft.get("tokens", []))]
    return []


def require_viewer(request: Request, *, chart_id: str = None, vista_id: str = None, asset_key: str = None) -> None:
    """Lets a signed-in user through; a paired screen only for what's on
    screen right now. 401 otherwise."""
    if current_user(request):
        return
    if has_screen_key(request.cookies):
        if chart_id is not None and displayed_item("chart") == chart_id.strip("/"):
            return
        if vista_id is not None and displayed_item("vista") == vista_id.strip("/"):
            return
        if asset_key is not None and asset_key in displayed_asset_keys():
            return
    raise HTTPException(status_code=401, detail="Not authenticated")


def websocket_allowed(websocket) -> bool:
    """The screen socket carries what the GM is showing, so it's for
    signed-in users and paired screens only."""
    return current_user(websocket) is not None or has_screen_key(websocket.cookies)
