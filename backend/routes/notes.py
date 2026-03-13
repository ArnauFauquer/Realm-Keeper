from fastapi import APIRouter, HTTPException, Query
from pathlib import Path
from typing import List, Optional
from models.note import Note, NoteMetadata
from services.markdown_service import MarkdownService
from config.settings import settings
from config.logging import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/api", tags=["notes"])

markdown_service = MarkdownService(
    vault_path=str(settings.VAULT_PATH),
    repo_url=settings.REPO_URL,
    ignore_tag=settings.NOTE_TAG_IGNORE
)

@router.get("/notes", response_model=List[NoteMetadata])
async def get_all_notes(
    search: Optional[str] = Query(None),
    tags: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0)
):
    try:
        all_notes = markdown_service.get_all_notes()
        
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
async def get_note(note_path: str):
    normalized_path = note_path.strip('/')
    
    try:
        full_path = (Path(markdown_service.vault_path) / f"{normalized_path}.md").resolve()
        vault_resolved = Path(markdown_service.vault_path).resolve()
        full_path.relative_to(vault_resolved)
    except (ValueError, RuntimeError):
        raise HTTPException(
            status_code=403,
            detail="Access denied: path must be within vault"
        )
    
    note = markdown_service.get_note(normalized_path)
    
    if not note:
        raise HTTPException(status_code=404, detail=f"Note not found: {note_path}")
    
    return note

@router.post("/sync")
async def sync_vault():
    if not settings.REPO_URL:
        raise HTTPException(
            status_code=400, 
            detail="No repository URL configured. Set REPO_URL environment variable."
        )
    
    success = markdown_service.sync_repository()
    
    if not success:
        raise HTTPException(status_code=500, detail="Failed to sync repository")
    
    return {"message": "Vault synced successfully"}

@router.get("/tags", response_model=List[str])
async def get_all_tags():
    try:
        return markdown_service.get_all_tags()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error getting tags: {str(e)}")

@router.get("/container-folders", response_model=List[str])
async def get_container_folders():
    try:
        all_notes = markdown_service.get_all_notes()
        all_note_ids = set(n.id for n in all_notes)
        
        folders_found = set()
        for note_id in all_note_ids:
            parts = note_id.split('/')
            for i in range(len(parts) - 1):
                folder_path = '/'.join(parts[:i + 1])
                folders_found.add(folder_path)
        
        container_folders = set()
        for folder in folders_found:
            if folder not in all_note_ids:
                container_folders.add(folder.split('/')[-1])
        
        return sorted(list(container_folders))
    except Exception as e:
        logger.error(f"Error getting container folders: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error getting container folders: {str(e)}")

@router.get("/vault/info")
async def get_vault_info():
    notes = markdown_service.get_all_notes()
    
    return {
        "vault_path": str(markdown_service.vault_path),
        "total_notes": len(notes),
        "repo_url": settings.REPO_URL,
        "has_git": (markdown_service.vault_path / '.git').exists()
    }

@router.get("/graph/all")
async def get_graph_data():
    try:
        notes_metadata = markdown_service.get_all_notes()
        
        nodes = []
        node_ids = set()
        title_to_id = {}
        
        for note_meta in notes_metadata:
            node_ids.add(note_meta.id)
            title_to_id[note_meta.title] = note_meta.id
            
            nodes.append({
                "id": note_meta.id,
                "title": note_meta.title,
                "path": note_meta.id,
                "tags": note_meta.tags,
                "type": note_meta.type
            })
        
        links = []
        links_set = set()
        
        for note_meta in notes_metadata:
            wikilinks = markdown_service.get_note_links_only(note_meta.id)
            
            for link in wikilinks:
                target_id = None
                
                if link in node_ids:
                    target_id = link
                elif link in title_to_id:
                    target_id = title_to_id[link]
                else:
                    link_lower = link.lower()
                    for title, note_id in title_to_id.items():
                        if title.lower() == link_lower:
                            target_id = note_id
                            break
                
                if target_id:
                    link_key = (note_meta.id, target_id)
                    if link_key not in links_set:
                        links_set.add(link_key)
                        links.append({
                            "source": note_meta.id,
                            "target": target_id
                        })
        
        return {
            "nodes": nodes,
            "links": links
        }
    except Exception as e:
        logger.error(f"Error generating graph: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error generating graph: {str(e)}")
