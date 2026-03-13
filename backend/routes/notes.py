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
    repo_url=settings.REPO_URL,
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
        all_notes = service.get_all_notes()
        
        if search:
            from fuzzywuzzy import fuzz
            all_notes = [
                n for n in all_notes
                if fuzz.token_set_ratio(search.lower(), n.title.lower()) > 60
            ]
        
        if tags:
            tag_list = [t.strip().lower() for t in tags.split(',') if t.strip()]
            all_notes = [
                n for n in all_notes
                if any(t.lower() in [nt.lower() for nt in n.tags] for t in tag_list)
            ]
        
        paginated = all_notes[offset:offset + limit]
        
        return paginated
    except Exception as e:
        logger.error(f"Error getting notes: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error getting notes: {str(e)}")

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

@router.post("/sync")
async def sync_vault(service: MarkdownService = Depends(get_markdown_service)):
    if not settings.REPO_URL:
        raise HTTPException(
            status_code=400, 
            detail="No repository URL configured. Set REPO_URL environment variable."
        )
    
    success = service.sync_repository()
    
    if not success:
        raise HTTPException(status_code=500, detail="Failed to sync repository")
    
    return {"message": "Vault synced successfully"}

@router.get("/tags", response_model=List[str])
async def get_all_tags(service: MarkdownService = Depends(get_markdown_service)):
    try:
        return service.get_all_tags()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error getting tags: {str(e)}")

@router.get("/container-folders", response_model=List[str])
async def get_container_folders(service: MarkdownService = Depends(get_markdown_service)):
    try:
        return service.get_container_folders()
    except Exception as e:
        logger.error(f"Error getting container folders: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error getting container folders: {str(e)}")

@router.get("/vault/info")
async def get_vault_info(service: MarkdownService = Depends(get_markdown_service)):
    notes = service.get_all_notes()
    
    return {
        "vault_path": str(service.vault_path),
        "total_notes": len(notes),
        "repo_url": settings.REPO_URL,
        "has_git": (service.vault_path / '.git').exists()
    }

@router.get("/graph/all")
async def get_graph_data(service: MarkdownService = Depends(get_markdown_service)):
    try:
        return service.get_graph_data()
    except Exception as e:
        logger.error(f"Error generating graph: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error generating graph: {str(e)}")
