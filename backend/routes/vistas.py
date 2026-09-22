from typing import List, Optional

from botocore.exceptions import BotoCoreError, ClientError
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from config.logging import get_logger
from config.settings import settings
from models.vista import VanishingPoint, Vista, VistaAsset
from routes.auth import require_auth
from routes.errors import storage_unavailable
from services import storage_service
from services.vista_service import VistaSaveError, VistaService
from services.storage_service import StorageError

logger = get_logger(__name__)

router = APIRouter(prefix="/api/vistas", tags=["vistas"])

vista_service_instance = VistaService(vault_path=str(settings.VAULT_PATH))


def get_vista_service() -> VistaService:
    return vista_service_instance


class VistaCreateRequest(BaseModel):
    name: str
    description: Optional[str] = None
    folder_path: str = ""


class VistaSaveRequest(BaseModel):
    name: str
    description: Optional[str] = None
    vanishing_point: VanishingPoint = VanishingPoint()
    background_offset_y: float = 50.0
    assets: List[VistaAsset] = []


class FolderCreateRequest(BaseModel):
    path: str


class FolderRenameRequest(BaseModel):
    name: str


class FolderMoveRequest(BaseModel):
    path: str
    dest_parent_path: str = ""


class VistaMoveRequest(BaseModel):
    vista_id: str
    folder_path: str = ""


class VistaRenameRequest(BaseModel):
    vista_id: str
    name: str


@router.get("")
async def list_vistas(path: str = "", service: VistaService = Depends(get_vista_service)):
    try:
        return service.list_tree(path)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("", response_model=Vista)
async def create_vista(
    body: VistaCreateRequest,
    user: dict = Depends(require_auth),
    service: VistaService = Depends(get_vista_service),
):
    try:
        return service.create_vista(
            body.name, body.description, body.folder_path,
            author_name=user.get("name") or user["email"], author_email=user["email"],
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except VistaSaveError as e:
        logger.error(f"Failed to create vista {body.name}: {e}")
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/assets/{key:path}")
async def get_vista_asset(key: str):
    try:
        obj = storage_service.get_object_stream(key)
    except StorageError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except (ClientError, BotoCoreError):
        raise HTTPException(status_code=404, detail="Asset not found")

    def iterfile():
        for chunk in obj["Body"].iter_chunks(chunk_size=64 * 1024):
            yield chunk

    return StreamingResponse(
        iterfile(),
        media_type=obj.get("ContentType", "application/octet-stream"),
        headers={"Content-Length": str(obj["ContentLength"])},
    )


# ── folders ────────────────────────────────────────────────────────────
# Declared ahead of the "/{vista_id}" routes below — those use a `:path`
# converter and would otherwise swallow "/folders/..." as a vista id.

@router.post("/folders")
async def create_folder(
    body: FolderCreateRequest,
    user: dict = Depends(require_auth),
    service: VistaService = Depends(get_vista_service),
):
    try:
        service.create_folder(
            body.path, author_name=user.get("name") or user["email"], author_email=user["email"],
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except VistaSaveError as e:
        logger.error(f"Failed to create vista folder {body.path}: {e}")
        raise HTTPException(status_code=502, detail=str(e))
    return {"status": "success"}


@router.put("/folders/{path:path}")
async def rename_folder(
    path: str,
    body: FolderRenameRequest,
    user: dict = Depends(require_auth),
    service: VistaService = Depends(get_vista_service),
):
    try:
        service.rename_folder(
            path, body.name, author_name=user.get("name") or user["email"], author_email=user["email"],
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except VistaSaveError as e:
        logger.error(f"Failed to rename vista folder {path}: {e}")
        raise HTTPException(status_code=502, detail=str(e))
    return {"status": "success"}


@router.delete("/folders/{path:path}")
async def delete_folder(
    path: str,
    user: dict = Depends(require_auth),
    service: VistaService = Depends(get_vista_service),
):
    try:
        doomed_ids = service.delete_folder(
            path, author_name=user.get("name") or user["email"], author_email=user["email"],
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except VistaSaveError as e:
        logger.error(f"Failed to delete vista folder {path}: {e}")
        raise HTTPException(status_code=502, detail=str(e))

    for vista_id in doomed_ids:
        try:
            storage_service.delete_vista_assets(vista_id)
        except (ClientError, BotoCoreError) as e:
            logger.error(f"Failed to delete assets for vista {vista_id}: {e}")

    return {"status": "success"}


@router.post("/folders/move")
async def move_folder(
    body: FolderMoveRequest,
    user: dict = Depends(require_auth),
    service: VistaService = Depends(get_vista_service),
):
    try:
        service.move_folder(
            body.path, body.dest_parent_path,
            author_name=user.get("name") or user["email"], author_email=user["email"],
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except VistaSaveError as e:
        logger.error(f"Failed to move vista folder {body.path}: {e}")
        raise HTTPException(status_code=502, detail=str(e))
    return {"status": "success"}


@router.post("/move")
async def move_vista(
    body: VistaMoveRequest,
    user: dict = Depends(require_auth),
    service: VistaService = Depends(get_vista_service),
):
    try:
        new_id = service.move_vista(
            body.vista_id, body.folder_path,
            author_name=user.get("name") or user["email"], author_email=user["email"],
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except VistaSaveError as e:
        logger.error(f"Failed to move vista {body.vista_id}: {e}")
        raise HTTPException(status_code=502, detail=str(e))
    return {"status": "success", "id": new_id}


@router.post("/rename")
async def rename_vista(
    body: VistaRenameRequest,
    user: dict = Depends(require_auth),
    service: VistaService = Depends(get_vista_service),
):
    try:
        return service.rename_vista(
            body.vista_id, body.name,
            author_name=user.get("name") or user["email"], author_email=user["email"],
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except VistaSaveError as e:
        logger.error(f"Failed to rename vista {body.vista_id}: {e}")
        raise HTTPException(status_code=502, detail=str(e))


# ── vistas (by id) ────────────────────────────────────────────────────

@router.get("/{vista_id:path}", response_model=Vista)
async def get_vista(vista_id: str, service: VistaService = Depends(get_vista_service)):
    vista = service.get_vista(vista_id)
    if vista is None:
        raise HTTPException(status_code=404, detail=f"Vista not found: {vista_id}")
    return vista


@router.put("/{vista_id:path}", response_model=Vista)
async def save_vista(
    vista_id: str,
    body: VistaSaveRequest,
    user: dict = Depends(require_auth),
    service: VistaService = Depends(get_vista_service),
):
    try:
        return service.save_vista(
            vista_id, body.name, body.description, body.vanishing_point, body.background_offset_y, body.assets,
            author_name=user.get("name") or user["email"], author_email=user["email"],
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except VistaSaveError as e:
        logger.error(f"Failed to save vista {vista_id}: {e}")
        raise HTTPException(status_code=502, detail=str(e))


@router.delete("/{vista_id:path}")
async def delete_vista(
    vista_id: str,
    user: dict = Depends(require_auth),
    service: VistaService = Depends(get_vista_service),
):
    try:
        service.delete_vista(vista_id, author_name=user.get("name") or user["email"], author_email=user["email"])
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except VistaSaveError as e:
        logger.error(f"Failed to delete vista {vista_id}: {e}")
        raise HTTPException(status_code=502, detail=str(e))

    try:
        storage_service.delete_vista_assets(vista_id)
    except (ClientError, BotoCoreError) as e:
        logger.error(f"Failed to delete assets for vista {vista_id}: {e}")

    return {"status": "success"}


@router.post("/{vista_id:path}/background", response_model=Vista)
async def upload_vista_background(
    vista_id: str,
    file: UploadFile = File(...),
    user: dict = Depends(require_auth),
    service: VistaService = Depends(get_vista_service),
):
    try:
        result = storage_service.upload_vista_background(vista_id, file.filename, file.file, file.content_type)
    except StorageError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except (ClientError, BotoCoreError) as e:
        raise storage_unavailable(logger, e)

    background_url = f"/api/vistas/assets/{result['key']}"
    try:
        return service.set_background_url(
            vista_id, background_url,
            author_name=user.get("name") or user["email"], author_email=user["email"],
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except VistaSaveError as e:
        logger.error(f"Failed to save background for vista {vista_id}: {e}")
        raise HTTPException(status_code=502, detail=str(e))
