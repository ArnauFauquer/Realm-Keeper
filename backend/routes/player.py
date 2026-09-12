from typing import Dict

from botocore.exceptions import BotoCoreError, ClientError
from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse

from config.logging import get_logger
from services import storage_service
from services.storage_service import StorageError

logger = get_logger(__name__)
router = APIRouter(prefix="/api/player", tags=["player"])


def _storage_unavailable(e: Exception) -> HTTPException:
    logger.error(f"Object storage error: {e}")
    return HTTPException(status_code=502, detail="Could not reach object storage")


@router.get("/albums")
async def get_albums():
    try:
        return {"albums": storage_service.list_albums()}
    except (ClientError, BotoCoreError) as e:
        raise _storage_unavailable(e)


@router.post("/albums")
async def create_album(data: Dict[str, str]):
    try:
        storage_service.create_album(data.get("name", ""))
    except StorageError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except (ClientError, BotoCoreError) as e:
        raise _storage_unavailable(e)
    return {"status": "success"}


@router.delete("/albums/{album}")
async def delete_album(album: str):
    try:
        storage_service.delete_album(album)
    except StorageError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except (ClientError, BotoCoreError) as e:
        raise _storage_unavailable(e)
    return {"status": "success"}


@router.get("/albums/{album}/tracks")
async def get_tracks(album: str):
    try:
        return {"tracks": storage_service.list_tracks(album)}
    except StorageError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except (ClientError, BotoCoreError) as e:
        raise _storage_unavailable(e)


@router.post("/albums/{album}/tracks")
async def upload_track(album: str, file: UploadFile = File(...)):
    try:
        result = storage_service.upload_track(album, file.filename, file.file, file.content_type)
    except StorageError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except (ClientError, BotoCoreError) as e:
        raise _storage_unavailable(e)
    return result


@router.delete("/tracks/{key:path}")
async def delete_track(key: str):
    try:
        storage_service.delete_track(key)
    except StorageError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except (ClientError, BotoCoreError) as e:
        raise _storage_unavailable(e)
    return {"status": "success"}


@router.get("/stream/{key:path}")
async def stream_track(key: str, request: Request):
    range_header = request.headers.get("range")
    try:
        obj = storage_service.get_object_stream(key, range_header)
    except StorageError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except (ClientError, BotoCoreError):
        raise HTTPException(status_code=404, detail="Track not found")

    headers = {
        "Accept-Ranges": "bytes",
        "Content-Length": str(obj["ContentLength"]),
    }
    status_code = 200
    if range_header and "ContentRange" in obj:
        headers["Content-Range"] = obj["ContentRange"]
        status_code = 206

    def iterfile():
        for chunk in obj["Body"].iter_chunks(chunk_size=64 * 1024):
            yield chunk

    return StreamingResponse(
        iterfile(),
        status_code=status_code,
        media_type=obj.get("ContentType", "application/octet-stream"),
        headers=headers,
    )
