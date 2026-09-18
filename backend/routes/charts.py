from typing import List, Optional

from botocore.exceptions import BotoCoreError, ClientError
from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from config.logging import get_logger
from config.settings import settings
from models.chart import Annotation, Chart, ChartMetadata, ChartPath, Pin
from routes.auth import require_auth
from services import storage_service
from services.chart_service import ChartSaveError, ChartService
from services.storage_service import StorageError

logger = get_logger(__name__)

router = APIRouter(prefix="/api/charts", tags=["charts"])

chart_service_instance = ChartService(vault_path=str(settings.VAULT_PATH))


def get_chart_service() -> ChartService:
    return chart_service_instance


def _storage_unavailable(e: Exception) -> HTTPException:
    logger.error(f"Object storage error: {e}")
    return HTTPException(status_code=502, detail="Could not reach object storage")


class ChartCreateRequest(BaseModel):
    name: str
    description: Optional[str] = None


class ChartSaveRequest(BaseModel):
    name: str
    description: Optional[str] = None
    pins: List[Pin] = []
    paths: List[ChartPath] = []
    annotations: List[Annotation] = []


@router.get("", response_model=List[ChartMetadata])
async def list_charts(service: ChartService = Depends(get_chart_service)):
    return service.list_charts()


@router.post("", response_model=Chart)
async def create_chart(
    body: ChartCreateRequest,
    user: dict = Depends(require_auth),
    service: ChartService = Depends(get_chart_service),
):
    try:
        return service.create_chart(
            body.name, body.description,
            author_name=user.get("name") or user["email"], author_email=user["email"],
        )
    except ChartSaveError as e:
        logger.error(f"Failed to create chart {body.name}: {e}")
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/assets/{key:path}")
async def get_chart_asset(key: str):
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


@router.get("/{chart_id}", response_model=Chart)
async def get_chart(chart_id: str, service: ChartService = Depends(get_chart_service)):
    chart = service.get_chart(chart_id)
    if chart is None:
        raise HTTPException(status_code=404, detail=f"Chart not found: {chart_id}")
    return chart


@router.put("/{chart_id}", response_model=Chart)
async def save_chart(
    chart_id: str,
    body: ChartSaveRequest,
    user: dict = Depends(require_auth),
    service: ChartService = Depends(get_chart_service),
):
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


@router.delete("/{chart_id}")
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

    try:
        storage_service.delete_chart_assets(chart_id)
    except (ClientError, BotoCoreError) as e:
        logger.error(f"Failed to delete assets for chart {chart_id}: {e}")

    return {"status": "success"}


@router.post("/{chart_id}/image", response_model=Chart)
async def upload_chart_image(
    chart_id: str,
    file: UploadFile = File(...),
    user: dict = Depends(require_auth),
    service: ChartService = Depends(get_chart_service),
):
    try:
        result = storage_service.upload_chart_image(chart_id, file.filename, file.file, file.content_type)
    except StorageError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except (ClientError, BotoCoreError) as e:
        raise _storage_unavailable(e)

    image_url = f"/api/charts/assets/{result['key']}"
    try:
        return service.set_image_url(
            chart_id, image_url,
            author_name=user.get("name") or user["email"], author_email=user["email"],
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ChartSaveError as e:
        logger.error(f"Failed to save image for chart {chart_id}: {e}")
        raise HTTPException(status_code=502, detail=str(e))


@router.post("/{chart_id}/pins/{pin_id}/icon")
async def upload_pin_icon(
    chart_id: str,
    pin_id: str,
    file: UploadFile = File(...),
    user: dict = Depends(require_auth),
):
    try:
        result = storage_service.upload_pin_icon(chart_id, pin_id, file.filename, file.file, file.content_type)
    except StorageError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except (ClientError, BotoCoreError) as e:
        raise _storage_unavailable(e)

    return {"icon_url": f"/api/charts/assets/{result['key']}"}
