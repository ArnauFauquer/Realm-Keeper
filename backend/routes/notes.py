from fastapi import APIRouter, HTTPException, Query, Depends
from pathlib import Path
from typing import List, Optional, Dict
from models.note import Note, NoteMetadata
from services.markdown_service import MarkdownService
from config.settings import settings
from config.logging import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/api", tags=["notes"])

md_service_instance = MarkdownService(
    vault_path=str(settings.VAULT_PATH),
    ignore_tag=settings.NOTE_TAG_IGNORE
)


def get_markdown_service() -> MarkdownService:
    return md_service_instance

@router.get("/notes", response_model=List[NoteMetadata])
async def get_all_notes(
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
async def get_note(note_path: str, service: MarkdownService = Depends(get_markdown_service)):
    normalized_path = note_path.strip('/')
    
    try:
        full_path = (Path(service.vault_path) / f"{normalized_path}.md").resolve()
        vault_resolved = Path(service.vault_path).resolve()
        full_path.relative_to(vault_resolved)
    except (ValueError, RuntimeError):
        raise HTTPException(
            status_code=403,
            detail="Access denied: path must be within vault"
        )
    
    note = service.get_note(normalized_path)
    
    if not note:
        raise HTTPException(status_code=404, detail=f"Note not found: {note_path}")
    
    return note

@router.get("/tags", response_model=List[str])
async def get_all_tags(service: MarkdownService = Depends(get_markdown_service)):
    try:
        return service.get_all_tags()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error getting tags: {str(e)}")

@router.get("/container-folders", response_model=Dict[str, Optional[str]])
async def get_container_folders(service: MarkdownService = Depends(get_markdown_service)):
    try:
        return service.get_container_folders()
    except Exception as e:
        logger.error(f"Error getting container folders: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error getting container folders: {str(e)}")

@router.get("/graph/all")
async def get_graph_data(service: MarkdownService = Depends(get_markdown_service)):
    try:
        return service.get_graph_data()
    except Exception as e:
        logger.error(f"Error generating graph: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error generating graph: {str(e)}")
