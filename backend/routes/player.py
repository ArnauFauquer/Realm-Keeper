"""The audio player's albums and tracks (services/storage_service.py).

Every handler is a plain `def`: FastAPI runs those in its threadpool, so an
upload of a whole track or a copy of a whole album to S3 never holds up the
event loop, and with it every live socket and screen."""
from contextlib import contextmanager
from typing import Dict

from botocore.exceptions import BotoCoreError, ClientError
from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse

from config.logging import get_logger
from routes.observatory import UPLOADED_FILE_HEADERS
from routes.errors import storage_unavailable
from services import storage_service
from services.storage_service import StorageError

logger = get_logger(__name__)
router = APIRouter(prefix="/api/player", tags=["player"])


@contextmanager
def storage_errors():
    """A bad name is the caller's mistake (400); a store that fails is a 502."""
    try:
        yield
    except StorageError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except (ClientError, BotoCoreError) as e:
        raise storage_unavailable(logger, e)


@router.get("/albums")
def get_albums():
    with storage_errors():
        return {"albums": storage_service.list_albums()}


@router.post("/albums")
def create_album(data: Dict[str, str]):
    with storage_errors():
        storage_service.create_album(data.get("name", ""))
    return {"status": "success"}


@router.delete("/albums/{album}")
def delete_album(album: str):
    with storage_errors():
        storage_service.delete_album(album)
    return {"status": "success"}


@router.put("/albums/{album}")
def rename_album(album: str, data: Dict[str, str]):
    with storage_errors():
        storage_service.rename_album(album, data.get("name", ""))
    return {"status": "success"}


@router.get("/albums/{album}/tracks")
def get_tracks(album: str):
    with storage_errors():
        return {"tracks": storage_service.list_tracks(album)}


@router.post("/albums/{album}/tracks")
def upload_track(album: str, file: UploadFile = File(...)):
    with storage_errors():
        return storage_service.upload_track(album, file.filename, file.file, file.content_type)


@router.post("/tracks/move")
def move_track(data: Dict[str, str]):
    with storage_errors():
        return storage_service.move_track(data.get("key", ""), data.get("album", ""))


@router.post("/tracks/rename")
def rename_track(data: Dict[str, str]):
    with storage_errors():
        return storage_service.rename_track(data.get("key", ""), data.get("name", ""))


@router.delete("/tracks/{key:path}")
def delete_track(key: str):
    with storage_errors():
        storage_service.delete_track(key)
    return {"status": "success"}


@router.get("/stream/{key:path}")
def stream_track(key: str, request: Request):
    range_header = request.headers.get("range")
    try:
        obj = storage_service.get_track_stream(key, range_header)
    except StorageError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except (ClientError, BotoCoreError):
        raise HTTPException(status_code=404, detail="Track not found")

    headers = {
        "Accept-Ranges": "bytes",
        "Content-Length": str(obj["ContentLength"]),
        **UPLOADED_FILE_HEADERS,
    }
    status_code = 200
    if range_header and "ContentRange" in obj:
        headers["Content-Range"] = obj["ContentRange"]
        status_code = 206

    def iterfile():
        # Closed however the playback ends (a seek or a skip hangs up halfway),
        # so the connection goes back to the pool.
        with obj["Body"] as body:
            yield from body.iter_chunks(chunk_size=64 * 1024)

    return StreamingResponse(
        iterfile(),
        status_code=status_code,
        media_type=storage_service.content_type_for(key),
        headers=headers,
    )
