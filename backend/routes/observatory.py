"""The Observatory's routes (services/observatory.py): a folder's contents, the
folders themselves, the images, a folder exported as a zip, and files imported
into one.

Everything needs a login, except reading an image, which a paired screen may
do for what is on screen (routes/screen_access.py). A document is created,
opened, saved, renamed, moved and deleted through its own kind's routes
(routes/doc_router.py); what moving or deleting a folder does to the documents
in it (the live ones let go, the notes that link to them followed) is done here.
"""
import contextlib
import logging
import tempfile
from typing import Callable, Dict, List, Mapping, Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from routes.auth import require_auth
from routes.doc_router import OnMoved
from routes.errors import blocking, guarded
from services.observatory import Observatory
from services.sync_hub import DocHub

logger = logging.getLogger(__name__)

# Sent with every user-uploaded file served from the app's own origin. SVGs
# can carry <script>, and opened directly (not via <img>) they'd run with the
# app's origin; the sandboxing CSP neuters that, nosniff stops a browser from
# second-guessing the extension-derived Content-Type.
UPLOADED_FILE_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
}
# A backup is written to memory up to this size, then to a temporary file.
EXPORT_SPOOL_BYTES = 64 * 1024 * 1024


class FolderBody(BaseModel):
    path: str


class FolderRenameBody(BaseModel):
    name: str


class FolderMoveBody(BaseModel):
    path: str
    dest_parent_path: str = ""


class ImageMoveBody(BaseModel):
    id: str
    folder_path: str = ""


class ImageRenameBody(BaseModel):
    id: str
    name: str


def _ascii(name: str) -> str:
    return "".join(c if c.isascii() and c.isprintable() and c not in '"\\' else "_" for c in name)


def make_observatory_router(
    observatory: Observatory, hub: DocHub, on_moved: Mapping[str, OnMoved],
    image_viewer: Callable[[Request, str], None],
) -> APIRouter:
    """`on_moved[kind]` follows the documents of that kind a folder move gave
    new ids (see routes/doc_follow.py); `image_viewer(request, name)` lets a
    request read an image or raises."""
    router = APIRouter(prefix="/api/observatory", tags=["observatory"])

    def live(kind: str) -> bool:
        return observatory.collections[kind].doctype.live

    @contextlib.asynccontextmanager
    async def released(path: str):
        """Around moving or deleting a folder: the live documents inside are
        saved and let go of first, and nothing saves them back where they were
        (see DocHub.released)."""
        inside = await blocking(observatory.ids_under, path)
        async with contextlib.AsyncExitStack() as stack:
            for kind, ids in inside.items():
                if ids and live(kind):
                    await stack.enter_async_context(hub.released(kind, ids))
            yield

    async def move(path: str, user: dict, parent: Optional[str] = None, name: Optional[str] = None) -> None:
        async with released(path):
            moves = await blocking(observatory.move_folder, path, parent, name)
        for kind, kind_moves in moves.items():
            if kind in on_moved:
                # Each kind on its own: the folder has moved already, and what
                # one kind failed to follow mustn't stop the next (see doc_follow).
                try:
                    await on_moved[kind](kind_moves, user)
                except Exception:
                    logger.exception(f"Could not follow the {kind}s moved with '{path}'")

    # ── folders ─────────────────────────────────────────────────────────

    @router.get("")
    @guarded
    async def list_folder(path: str = "", user: dict = Depends(require_auth)):
        return await blocking(observatory.list, path)

    @router.get("/search")
    @guarded
    async def search(q: str = "", user: dict = Depends(require_auth)):
        """Documents and images matching `q`, of every kind, in every folder."""
        return {"items": await blocking(observatory.search, q)}

    @router.get("/all")
    @guarded
    async def list_kind(kind: str, user: dict = Depends(require_auth)):
        """Everything of one kind, in every folder."""
        return await blocking(observatory.list_kind, kind)

    @router.post("/folders")
    @guarded
    async def create_folder(body: FolderBody, user: dict = Depends(require_auth)):
        await blocking(observatory.create_folder, body.path)
        return {"status": "success"}

    @router.post("/folders/move")
    @guarded
    async def move_folder(body: FolderMoveBody, user: dict = Depends(require_auth)):
        await move(body.path, user, parent=body.dest_parent_path)
        return {"status": "success"}

    @router.put("/folders/{path:path}")
    @guarded
    async def rename_folder(path: str, body: FolderRenameBody, user: dict = Depends(require_auth)):
        await move(path, user, name=body.name)
        return {"status": "success"}

    @router.delete("/folders/{path:path}")
    @guarded
    async def delete_folder(path: str, user: dict = Depends(require_auth)):
        async with released(path):
            await blocking(observatory.delete_folder, path)
        return {"status": "success"}

    # ── images ──────────────────────────────────────────────────────────

    @router.post("/images/move")
    @guarded
    async def move_image(body: ImageMoveBody, user: dict = Depends(require_auth)):
        return await blocking(observatory.move_image, body.id, body.folder_path)

    @router.post("/images/rename")
    @guarded
    async def rename_image(body: ImageRenameBody, user: dict = Depends(require_auth)):
        return await blocking(observatory.rename_image, body.id, body.name)

    @router.get("/images/{name}")
    @guarded
    async def get_image(name: str, request: Request):
        # A paired screen's check may read the document on screen from storage.
        await blocking(image_viewer, request, name)
        chunks, length, content_type = await blocking(observatory.open_image, name)
        return StreamingResponse(
            chunks, media_type=content_type, headers={"Content-Length": str(length), **UPLOADED_FILE_HEADERS},
        )

    @router.delete("/images/{name}")
    @guarded
    async def delete_image(name: str, user: dict = Depends(require_auth)):
        await blocking(observatory.delete_image, name)
        return {"status": "success"}

    # ── backup ──────────────────────────────────────────────────────────

    @router.get("/export")
    @guarded
    async def export_backup(path: str = "", user: dict = Depends(require_auth)):
        """The folder at `path` (everything by default) as a zip, named from
        that folder: POST /import brings it back into any folder, here or on
        another instance."""
        await hub.flush_all()   # what is being played is stored as it is now
        spool = tempfile.SpooledTemporaryFile(max_size=EXPORT_SPOOL_BYTES)
        try:
            await blocking(observatory.export_zip, spool, path)
            size = spool.tell()
            spool.seek(0)
        except BaseException:
            spool.close()
            raise

        def chunks():
            with spool:
                while chunk := spool.read(1024 * 1024):
                    yield chunk

        leaf = path.strip("/").rsplit("/", 1)[-1] or "observatory"
        return StreamingResponse(chunks(), media_type="application/zip", headers={
            "Content-Length": str(size),
            "Content-Disposition": f"attachment; filename=\"{_ascii(leaf)}.zip\"; filename*=UTF-8''{quote(leaf, safe='')}.zip",
        })

    @router.post("/import")
    @guarded
    async def import_files(
        path: str = Form(""), files: List[UploadFile] = File(...), user: dict = Depends(require_auth),
    ):
        """Brings images, documents and zips of them (an export) into the folder
        at `path`; nothing already there is replaced."""
        report = await blocking(observatory.import_files, path, [(f.filename or "", f.file) for f in files])
        logger.info(f"Imported {len(report['items'])} files into '{path}'; left out {len(report['skipped'])}")
        return report

    return router


def _router() -> APIRouter:
    from routes.doc_follow import ON_MOVED
    from routes.screen_access import require_viewer
    from services.doc_registry import hub, observatory

    # Login, or a paired screen while the image is part of what's on screen.
    return make_observatory_router(
        observatory, hub, ON_MOVED, image_viewer=lambda request, name: require_viewer(request, image=name),
    )


router = _router()
