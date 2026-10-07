"""The audio player's albums and tracks (services/player_library.py).

Every handler is a plain `def`: FastAPI runs those in its threadpool, so an
upload of a whole track or a copy of a whole album never holds up the event
loop, and with it every live socket and screen."""
from contextlib import contextmanager
from typing import Dict

from botocore.exceptions import BotoCoreError, ClientError
from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse

from config.logging import get_logger
from routes.observatory import UPLOADED_FILE_HEADERS
from routes.errors import storage_unavailable
from services import storage_service
from services.doc_backend import DocBackendError
from services.doc_registry import doc_backend
from services.player_library import PlayerLibrary, RangeNotSatisfiable
from services.storage_service import StorageError

logger = get_logger(__name__)
router = APIRouter(prefix="/api/player", tags=["player"])
# In the same store as the documents and images.
library = PlayerLibrary(doc_backend)


@contextmanager
def storage_errors():
    """A bad name is the caller's mistake (400); a store that fails is a 502."""
    try:
        yield
    except (StorageError, DocBackendError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    except (ClientError, BotoCoreError, OSError) as e:
        raise storage_unavailable(logger, e)


@router.get("/albums")
def get_albums():
    with storage_errors():
        return {"albums": library.list_albums()}


@router.post("/albums")
def create_album(data: Dict[str, str]):
    with storage_errors():
        library.create_album(data.get("name", ""))
    return {"status": "success"}


@router.delete("/albums/{album}")
def delete_album(album: str):
    with storage_errors():
        library.delete_album(album)
    return {"status": "success"}


@router.put("/albums/{album}")
def rename_album(album: str, data: Dict[str, str]):
    with storage_errors():
        library.rename_album(album, data.get("name", ""))
    return {"status": "success"}


@router.get("/albums/{album}/tracks")
def get_tracks(album: str):
    with storage_errors():
        return {"tracks": library.list_tracks(album)}


@router.post("/albums/{album}/tracks")
def upload_track(album: str, file: UploadFile = File(...)):
    with storage_errors():
        return library.upload_track(album, file.filename, file.file)


@router.post("/tracks/move")
def move_track(data: Dict[str, str]):
    with storage_errors():
        return library.move_track(data.get("key", ""), data.get("album", ""))


@router.post("/tracks/rename")
def rename_track(data: Dict[str, str]):
    with storage_errors():
        return library.rename_track(data.get("key", ""), data.get("name", ""))


@router.delete("/tracks/{key:path}")
def delete_track(key: str):
    with storage_errors():
        library.delete_track(key)
    return {"status": "success"}


@router.get("/stream/{key:path}")
def stream_track(key: str, request: Request):
    try:
        track = library.open_track(key, request.headers.get("range"))
    except RangeNotSatisfiable as e:
        raise HTTPException(status_code=416, detail="Range not satisfiable", headers={"Content-Range": str(e)})
    except StorageError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except (ClientError, BotoCoreError, OSError) as e:
        raise storage_unavailable(logger, e)
    if track is None:
        raise HTTPException(status_code=404, detail="Track not found")

    headers = {
        "Accept-Ranges": "bytes",
        "Content-Length": str(track["length"]),
        **UPLOADED_FILE_HEADERS,
    }
    if track["content_range"]:
        headers["Content-Range"] = track["content_range"]

    return StreamingResponse(
        track["chunks"],
        status_code=206 if track["content_range"] else 200,
        media_type=storage_service.content_type_for(key),
        headers=headers,
    )
