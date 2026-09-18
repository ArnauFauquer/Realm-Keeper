from typing import List, Optional

from botocore.exceptions import BotoCoreError, ClientError
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from config.logging import get_logger
from config.settings import settings
from models.asset_library import LibraryAsset, LibraryFolder
from routes.auth import require_auth
from services import storage_service
from services.asset_library_service import AssetLibraryService, LibraryAssetSaveError
from services.storage_service import StorageError

logger = get_logger(__name__)

router = APIRouter(prefix="/api/asset-library", tags=["asset-library"])

asset_library_service_instance = AssetLibraryService(vault_path=str(settings.VAULT_PATH))


def get_asset_library_service() -> AssetLibraryService:
    return asset_library_service_instance


def _storage_unavailable(e: Exception) -> HTTPException:
    logger.error(f"Object storage error: {e}")
    return HTTPException(status_code=502, detail="Could not reach object storage")


class LibraryAssetCreateRequest(BaseModel):
    name: str
    folder_id: Optional[str] = None


class LibraryAssetUpdateRequest(BaseModel):
    name: str
    folder_id: Optional[str] = None


class LibraryFolderCreateRequest(BaseModel):
    name: str
    parent_id: Optional[str] = None


class LibraryFolderRenameRequest(BaseModel):
    name: str


@router.get("", response_model=List[LibraryAsset])
async def list_assets(service: AssetLibraryService = Depends(get_asset_library_service)):
    return service.list_assets()


@router.post("", response_model=LibraryAsset)
async def create_asset(
    body: LibraryAssetCreateRequest,
    user: dict = Depends(require_auth),
    service: AssetLibraryService = Depends(get_asset_library_service),
):
    try:
        return service.create_asset(
            body.name, body.folder_id,
            author_name=user.get("name") or user["email"], author_email=user["email"],
        )
    except LibraryAssetSaveError as e:
        logger.error(f"Failed to create library asset {body.name}: {e}")
        raise HTTPException(status_code=502, detail=str(e))


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


# ── folders ────────────────────────────────────────────────────────────
# Declared ahead of the "/{item_id}" routes below — those would otherwise
# swallow "/folders" as a literal item id.

@router.get("/folders", response_model=List[LibraryFolder])
async def list_folders(service: AssetLibraryService = Depends(get_asset_library_service)):
    return service.list_folders()


@router.post("/folders", response_model=LibraryFolder)
async def create_folder(
    body: LibraryFolderCreateRequest,
    user: dict = Depends(require_auth),
    service: AssetLibraryService = Depends(get_asset_library_service),
):
    try:
        return service.create_folder(
            body.name, body.parent_id,
            author_name=user.get("name") or user["email"], author_email=user["email"],
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except LibraryAssetSaveError as e:
        logger.error(f"Failed to create asset folder {body.name}: {e}")
        raise HTTPException(status_code=502, detail=str(e))


@router.put("/folders/{folder_id}", response_model=LibraryFolder)
async def rename_folder(
    folder_id: str,
    body: LibraryFolderRenameRequest,
    user: dict = Depends(require_auth),
    service: AssetLibraryService = Depends(get_asset_library_service),
):
    try:
        return service.rename_folder(
            folder_id, body.name,
            author_name=user.get("name") or user["email"], author_email=user["email"],
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except LibraryAssetSaveError as e:
        logger.error(f"Failed to rename asset folder {folder_id}: {e}")
        raise HTTPException(status_code=502, detail=str(e))


@router.delete("/folders/{folder_id}")
async def delete_folder(
    folder_id: str,
    user: dict = Depends(require_auth),
    service: AssetLibraryService = Depends(get_asset_library_service),
):
    try:
        deleted_assets = service.delete_folder(
            folder_id, author_name=user.get("name") or user["email"], author_email=user["email"],
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except LibraryAssetSaveError as e:
        logger.error(f"Failed to delete asset folder {folder_id}: {e}")
        raise HTTPException(status_code=502, detail=str(e))

    for asset in deleted_assets:
        try:
            storage_service.delete_library_asset(asset.id)
        except (ClientError, BotoCoreError) as e:
            logger.error(f"Failed to delete storage for library asset {asset.id}: {e}")

    return {"status": "success"}


# ── assets (by id) ────────────────────────────────────────────────────

@router.put("/{item_id}", response_model=LibraryAsset)
async def update_asset(
    item_id: str,
    body: LibraryAssetUpdateRequest,
    user: dict = Depends(require_auth),
    service: AssetLibraryService = Depends(get_asset_library_service),
):
    try:
        return service.update_asset(
            item_id, body.name, body.folder_id,
            author_name=user.get("name") or user["email"], author_email=user["email"],
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except LibraryAssetSaveError as e:
        logger.error(f"Failed to update library asset {item_id}: {e}")
        raise HTTPException(status_code=502, detail=str(e))


@router.delete("/{item_id}")
async def delete_asset(
    item_id: str,
    user: dict = Depends(require_auth),
    service: AssetLibraryService = Depends(get_asset_library_service),
):
    try:
        service.delete_asset(item_id, author_name=user.get("name") or user["email"], author_email=user["email"])
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except LibraryAssetSaveError as e:
        logger.error(f"Failed to delete library asset {item_id}: {e}")
        raise HTTPException(status_code=502, detail=str(e))

    try:
        storage_service.delete_library_asset(item_id)
    except (ClientError, BotoCoreError) as e:
        logger.error(f"Failed to delete storage for library asset {item_id}: {e}")

    return {"status": "success"}


@router.post("/{item_id}/image", response_model=LibraryAsset)
async def upload_asset_image(
    item_id: str,
    file: UploadFile = File(...),
    user: dict = Depends(require_auth),
    service: AssetLibraryService = Depends(get_asset_library_service),
):
    try:
        result = storage_service.upload_library_asset_image(item_id, file.filename, file.file, file.content_type)
    except StorageError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except (ClientError, BotoCoreError) as e:
        raise _storage_unavailable(e)

    image_url = f"/api/asset-library/assets/{result['key']}"
    try:
        return service.set_image_url(
            item_id, image_url,
            author_name=user.get("name") or user["email"], author_email=user["email"],
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except LibraryAssetSaveError as e:
        logger.error(f"Failed to save image for library asset {item_id}: {e}")
        raise HTTPException(status_code=502, detail=str(e))
