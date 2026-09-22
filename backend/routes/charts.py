from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from config.logging import get_logger
from config.settings import settings
from models.chart import Annotation, Chart, ChartPath, Pin
from routes.auth import require_auth
from routes.asset_library import ASSET_LIBRARY_URL_PREFIX
from services.chart_service import ChartSaveError, ChartService

logger = get_logger(__name__)

router = APIRouter(prefix="/api/charts", tags=["charts"])

chart_service_instance = ChartService(vault_path=str(settings.VAULT_PATH))


def get_chart_service() -> ChartService:
    return chart_service_instance


class ChartCreateRequest(BaseModel):
    name: str
    description: Optional[str] = None
    folder_path: str = ""


class ChartSaveRequest(BaseModel):
    name: str
    description: Optional[str] = None
    pins: List[Pin] = []
    paths: List[ChartPath] = []
    annotations: List[Annotation] = []


class ChartImageRequest(BaseModel):
    url: str


class FolderCreateRequest(BaseModel):
    path: str


class FolderRenameRequest(BaseModel):
    name: str


class FolderMoveRequest(BaseModel):
    path: str
    dest_parent_path: str = ""


class ChartMoveRequest(BaseModel):
    chart_id: str
    folder_path: str = ""


class ChartRenameRequest(BaseModel):
    chart_id: str
    name: str


@router.get("")
async def list_charts(path: str = "", service: ChartService = Depends(get_chart_service)):
    try:
        return service.list_tree(path)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("", response_model=Chart)
async def create_chart(
    body: ChartCreateRequest,
    user: dict = Depends(require_auth),
    service: ChartService = Depends(get_chart_service),
):
    try:
        return service.create_chart(
            body.name, body.description, body.folder_path,
            author_name=user.get("name") or user["email"], author_email=user["email"],
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except ChartSaveError as e:
        logger.error(f"Failed to create chart {body.name}: {e}")
        raise HTTPException(status_code=502, detail=str(e))


# ── folders ────────────────────────────────────────────────────────────
# Declared ahead of the "/{chart_id}" routes below — those use a `:path`
# converter and would otherwise swallow "/folders/..." as a chart id.

@router.post("/folders")
async def create_folder(
    body: FolderCreateRequest,
    user: dict = Depends(require_auth),
    service: ChartService = Depends(get_chart_service),
):
    try:
        service.create_folder(
            body.path, author_name=user.get("name") or user["email"], author_email=user["email"],
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except ChartSaveError as e:
        logger.error(f"Failed to create chart folder {body.path}: {e}")
        raise HTTPException(status_code=502, detail=str(e))
    return {"status": "success"}


@router.put("/folders/{path:path}")
async def rename_folder(
    path: str,
    body: FolderRenameRequest,
    user: dict = Depends(require_auth),
    service: ChartService = Depends(get_chart_service),
):
    try:
        service.rename_folder(
            path, body.name, author_name=user.get("name") or user["email"], author_email=user["email"],
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except ChartSaveError as e:
        logger.error(f"Failed to rename chart folder {path}: {e}")
        raise HTTPException(status_code=502, detail=str(e))
    return {"status": "success"}


@router.delete("/folders/{path:path}")
async def delete_folder(
    path: str,
    user: dict = Depends(require_auth),
    service: ChartService = Depends(get_chart_service),
):
    try:
        service.delete_folder(
            path, author_name=user.get("name") or user["email"], author_email=user["email"],
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except ChartSaveError as e:
        logger.error(f"Failed to delete chart folder {path}: {e}")
        raise HTTPException(status_code=502, detail=str(e))

    return {"status": "success"}


@router.post("/folders/move")
async def move_folder(
    body: FolderMoveRequest,
    user: dict = Depends(require_auth),
    service: ChartService = Depends(get_chart_service),
):
    try:
        service.move_folder(
            body.path, body.dest_parent_path,
            author_name=user.get("name") or user["email"], author_email=user["email"],
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except ChartSaveError as e:
        logger.error(f"Failed to move chart folder {body.path}: {e}")
        raise HTTPException(status_code=502, detail=str(e))
    return {"status": "success"}


@router.post("/move")
async def move_chart(
    body: ChartMoveRequest,
    user: dict = Depends(require_auth),
    service: ChartService = Depends(get_chart_service),
):
    try:
        new_id = service.move_chart(
            body.chart_id, body.folder_path,
            author_name=user.get("name") or user["email"], author_email=user["email"],
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except ChartSaveError as e:
        logger.error(f"Failed to move chart {body.chart_id}: {e}")
        raise HTTPException(status_code=502, detail=str(e))
    return {"status": "success", "id": new_id}


@router.post("/rename")
async def rename_chart(
    body: ChartRenameRequest,
    user: dict = Depends(require_auth),
    service: ChartService = Depends(get_chart_service),
):
    try:
        return service.rename_chart(
            body.chart_id, body.name,
            author_name=user.get("name") or user["email"], author_email=user["email"],
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ChartSaveError as e:
        logger.error(f"Failed to rename chart {body.chart_id}: {e}")
        raise HTTPException(status_code=502, detail=str(e))


# ── charts (by id) ───────────────────────────────────────────────────────

@router.get("/{chart_id:path}", response_model=Chart)
async def get_chart(chart_id: str, service: ChartService = Depends(get_chart_service)):
    chart = service.get_chart(chart_id)
    if chart is None:
        raise HTTPException(status_code=404, detail=f"Chart not found: {chart_id}")
    return chart


@router.put("/{chart_id:path}", response_model=Chart)
async def save_chart(
    chart_id: str,
    body: ChartSaveRequest,
    user: dict = Depends(require_auth),
    service: ChartService = Depends(get_chart_service),
):
    if any(pin.icon_url and not pin.icon_url.startswith(ASSET_LIBRARY_URL_PREFIX) for pin in body.pins):
        raise HTTPException(status_code=400, detail="Pin icons must be assets from the asset library")
    try:
        return service.save_chart(
            chart_id, body.name, body.description, body.pins, body.paths, body.annotations,
            author_name=user.get("name") or user["email"], author_email=user["email"],
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ChartSaveError as e:
        logger.error(f"Failed to save chart {chart_id}: {e}")
        raise HTTPException(status_code=502, detail=str(e))


@router.delete("/{chart_id:path}")
async def delete_chart(
    chart_id: str,
    user: dict = Depends(require_auth),
    service: ChartService = Depends(get_chart_service),
):
    try:
        service.delete_chart(chart_id, author_name=user.get("name") or user["email"], author_email=user["email"])
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ChartSaveError as e:
        logger.error(f"Failed to delete chart {chart_id}: {e}")
        raise HTTPException(status_code=502, detail=str(e))

    return {"status": "success"}


@router.post("/{chart_id:path}/image", response_model=Chart)
async def set_chart_image(
    chart_id: str,
    body: ChartImageRequest,
    user: dict = Depends(require_auth),
    service: ChartService = Depends(get_chart_service),
):
    if not body.url.startswith(ASSET_LIBRARY_URL_PREFIX):
        raise HTTPException(status_code=400, detail="Map image must be an asset from the asset library")
    try:
        return service.set_image_url(
            chart_id, body.url,
            author_name=user.get("name") or user["email"], author_email=user["email"],
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ChartSaveError as e:
        logger.error(f"Failed to save image for chart {chart_id}: {e}")
        raise HTTPException(status_code=502, detail=str(e))
