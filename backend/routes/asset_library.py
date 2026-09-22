from botocore.exceptions import BotoCoreError, ClientError
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from config.logging import get_logger
from routes.auth import require_auth
from routes.errors import storage_unavailable
from services import storage_service
from services.storage_service import StorageError

logger = get_logger(__name__)

router = APIRouter(prefix="/api/asset-library", tags=["asset-library"])

ASSET_LIBRARY_URL_PREFIX = "/api/asset-library/assets/"


class FolderCreateRequest(BaseModel):
    path: str


class FolderRenameRequest(BaseModel):
    name: str


class FolderMoveRequest(BaseModel):
    path: str
    dest_parent_path: str = ""


class AssetMoveRequest(BaseModel):
    key: str
    folder_path: str = ""


class AssetRenameRequest(BaseModel):
    key: str
    name: str


@router.get("")
async def list_library(path: str = ""):
    try:
        return storage_service.list_asset_library(path)
    except StorageError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except (ClientError, BotoCoreError) as e:
        raise storage_unavailable(logger, e)


@router.post("/folders")
async def create_folder(body: FolderCreateRequest, user: dict = Depends(require_auth)):
    try:
        storage_service.create_asset_folder(body.path)
    except StorageError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except (ClientError, BotoCoreError) as e:
        raise storage_unavailable(logger, e)
    return {"status": "success"}


@router.put("/folders/{path:path}")
async def rename_folder(path: str, body: FolderRenameRequest, user: dict = Depends(require_auth)):
    try:
        storage_service.rename_asset_folder(path, body.name)
    except StorageError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except (ClientError, BotoCoreError) as e:
        raise storage_unavailable(logger, e)
    return {"status": "success"}


@router.delete("/folders/{path:path}")
async def delete_folder(path: str, user: dict = Depends(require_auth)):
    try:
        storage_service.delete_asset_folder(path)
    except StorageError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except (ClientError, BotoCoreError) as e:
        raise storage_unavailable(logger, e)
    return {"status": "success"}


@router.post("/folders/move")
async def move_folder(body: FolderMoveRequest, user: dict = Depends(require_auth)):
    try:
        storage_service.move_asset_folder(body.path, body.dest_parent_path)
    except StorageError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except (ClientError, BotoCoreError) as e:
        raise storage_unavailable(logger, e)
    return {"status": "success"}


@router.post("/assets/move")
async def move_asset(body: AssetMoveRequest, user: dict = Depends(require_auth)):
    try:
        result = storage_service.move_library_asset(body.key, body.folder_path)
    except StorageError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except (ClientError, BotoCoreError) as e:
        raise storage_unavailable(logger, e)
    return {**result, "image_url": f"{ASSET_LIBRARY_URL_PREFIX}{result['key']}"}


@router.post("/assets/rename")
async def rename_asset(body: AssetRenameRequest, user: dict = Depends(require_auth)):
    try:
        result = storage_service.rename_library_asset(body.key, body.name)
    except StorageError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except (ClientError, BotoCoreError) as e:
        raise storage_unavailable(logger, e)
    return {**result, "image_url": f"{ASSET_LIBRARY_URL_PREFIX}{result['key']}"}


@router.post("/assets")
async def upload_asset(path: str = Form(""), file: UploadFile = File(...), user: dict = Depends(require_auth)):
    try:
        result = storage_service.upload_library_asset(path, file.filename, file.file, file.content_type)
    except StorageError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except (ClientError, BotoCoreError) as e:
        raise storage_unavailable(logger, e)
    return {**result, "image_url": f"{ASSET_LIBRARY_URL_PREFIX}{result['key']}"}


@router.get("/assets/{key:path}")
async def get_library_asset_file(key: str):
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


@router.delete("/assets/{key:path}")
async def delete_asset(key: str, user: dict = Depends(require_auth)):
    try:
        storage_service.delete_library_asset(key)
    except StorageError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except (ClientError, BotoCoreError) as e:
        raise storage_unavailable(logger, e)
    return {"status": "success"}
