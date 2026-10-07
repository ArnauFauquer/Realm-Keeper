"""The notes: reading them is public, writing needs a login.

Every handler here is a plain `def`: FastAPI runs those in its threadpool, so
parsing the vault or a commit and push (git can take a minute) never holds up
the event loop, and with it every live socket and screen."""
from fastapi import APIRouter, HTTPException, Query, Depends
from pydantic import BaseModel
from typing import List, Optional, Dict
from models.note import Note, NoteMetadata
from services.markdown_service import MarkdownService, NoteConflict, NoteSaveError, content_sha
from routes.auth import require_auth
from config.settings import settings
from config.logging import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/api", tags=["notes"])

md_service_instance = MarkdownService(
    vault_path=str(settings.VAULT_PATH),
    ignore_tag=settings.NOTE_TAG_IGNORE,
    git=settings.GIT_ENABLED,
)


def get_markdown_service() -> MarkdownService:
    return md_service_instance


def _note_id(service: MarkdownService, note_path: str) -> str:
    """The note's id, if it could name one (403 for "..", ".git"...). One that
    resolves outside the vault (a symlink) is then simply not found: a 404
    that doesn't say there is something there."""
    try:
        return service.check_note_id(note_path)
    except ValueError as e:
        raise HTTPException(status_code=403, detail=str(e))


@router.get("/notes", response_model=List[NoteMetadata])
def get_all_notes(
    search: Optional[str] = Query(None),
    tags: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    service: MarkdownService = Depends(get_markdown_service)
):
    try:
        all_notes = service.get_all_notes(search=search, tags=tags)
        return all_notes[offset:offset + limit]
    except Exception as e:
        logger.error(f"Error getting notes: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/note/{note_path:path}", response_model=Note)
def get_note(note_path: str, service: MarkdownService = Depends(get_markdown_service)):
    note = service.get_note(_note_id(service, note_path))
    if not note:
        raise HTTPException(status_code=404, detail=f"Note not found: {note_path}")
    return note


class NoteSaveRequest(BaseModel):
    content: str
    # The `sha` the editor loaded the note with (GET /note-raw): a save over
    # anything else is a 409. "" for a note that must not exist yet; left
    # out, nothing is checked.
    base_sha: Optional[str] = None


# Editor-only: the verbatim file (frontmatter included) is what the edit
# form loads, and it would otherwise hand out hidden (ignore-tagged) notes.
@router.get("/note-raw/{note_path:path}")
def get_note_raw(
    note_path: str,
    user: dict = Depends(require_auth),
    service: MarkdownService = Depends(get_markdown_service),
):
    try:
        content = service.get_raw_content(_note_id(service, note_path))
    except ValueError:
        content = None   # resolves outside the vault: not a note
    if content is None:
        raise HTTPException(status_code=404, detail=f"Note not found: {note_path}")
    return {"content": content, "sha": content_sha(content)}


@router.put("/note/{note_path:path}")
def save_note(
    note_path: str,
    body: NoteSaveRequest,
    user: dict = Depends(require_auth),
    service: MarkdownService = Depends(get_markdown_service)
):
    try:
        is_new, sha = service.save_note(
            note_path.strip('/'),
            body.content,
            author_name=user.get("name") or user["email"],
            author_email=user["email"],
            base_sha=body.base_sha,
        )
    except NoteConflict as e:
        raise HTTPException(status_code=409, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except NoteSaveError as e:
        logger.error(f"Failed to save note {note_path}: {e}")
        raise HTTPException(status_code=502, detail=str(e))

    return {"status": "created" if is_new else "updated", "sha": sha}


@router.get("/tags", response_model=List[str])
def get_all_tags(service: MarkdownService = Depends(get_markdown_service)):
    try:
        return service.get_all_tags()
    except Exception as e:
        logger.error(f"Error getting tags: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/container-folders", response_model=Dict[str, Optional[str]])
def get_container_folders(service: MarkdownService = Depends(get_markdown_service)):
    try:
        return service.get_container_folders()
    except Exception as e:
        logger.error(f"Error getting container folders: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/graph/all")
def get_graph_data(service: MarkdownService = Depends(get_markdown_service)):
    try:
        return service.get_graph_data()
    except Exception as e:
        logger.error(f"Error generating graph: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")
