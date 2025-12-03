from fastapi import APIRouter, HTTPException, Query
from typing import List, Optional
from models.note import Note, NoteMetadata
from services.markdown_service import MarkdownService
import os

router = APIRouter(prefix="/api", tags=["notes"])

# Inicializar el servicio
# El vault_path puede ser configurado via variable de entorno
VAULT_PATH = os.getenv("VAULT_PATH", "/app/vault")
REPO_URL = os.getenv("REPO_URL", None)
NOTE_TAG_IGNORE = os.getenv("NOTE_TAG_IGNORE", "draft")

markdown_service = MarkdownService(vault_path=VAULT_PATH, repo_url=REPO_URL, ignore_tag=NOTE_TAG_IGNORE)


@router.get("/notes", response_model=List[NoteMetadata])
async def get_all_notes(
    search: Optional[str] = Query(None, description="Buscar por título"),
    tags: Optional[str] = Query(None, description="Filtrar por tags (separados por coma)")
):
    """
    Obtiene todas las notas del vault manteniendo la estructura de directorios.
    Opcionalmente filtra por búsqueda de título y/o tags.
    """
    try:
        notes = markdown_service.get_all_notes()
        
        # Filter by search query
        if search:
            search_lower = search.lower()
            notes = [n for n in notes if search_lower in n.title.lower()]
        
        # Filter by tags
        if tags:
            tag_list = [t.strip().lower() for t in tags.split(',') if t.strip()]
            notes = [n for n in notes if any(t.lower() in [nt.lower() for nt in n.tags] for t in tag_list)]
        
        return notes
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error getting notes: {str(e)}")


@router.get("/note/{note_path:path}", response_model=Note)
async def get_note(note_path: str):
    """
    Obtiene una nota específica por su path relativo.
    Ejemplo: /api/note/Carpeta/Mi Nota
    """
    note = markdown_service.get_note(note_path)
    
    if not note:
        raise HTTPException(status_code=404, detail=f"Note not found: {note_path}")
    
    return note


@router.post("/sync")
async def sync_vault():
    """
    Sincroniza el vault con el repositorio remoto (pull o clone)
    """
    if not REPO_URL:
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
    """
    Obtiene todos los tags únicos del vault ordenados alfabéticamente.
    """
    try:
        return markdown_service.get_all_tags()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error getting tags: {str(e)}")


@router.get("/vault/info")
async def get_vault_info():
    """Información sobre el vault actual"""
    notes = markdown_service.get_all_notes()
    
    return {
        "vault_path": str(markdown_service.vault_path),
        "total_notes": len(notes),
        "repo_url": REPO_URL,
        "has_git": (markdown_service.vault_path / '.git').exists()
    }


@router.get("/graph/all")
async def get_graph_data():
    """
    Obtiene datos del grafo completo de todas las notas y sus wikilinks
    """
    try:
        # Get metadata for all notes
        notes_metadata = markdown_service.get_all_notes()
        
        # Create nodes and links
        nodes = []
        links = []
        node_ids = set()
        path_to_id = {}  # Map from path without .md to id
        
        # Create nodes for all notes
        for note_meta in notes_metadata:
            # Remove .md extension for matching with wikilinks
            path_without_ext = note_meta.path.replace('.md', '')
            node_ids.add(path_without_ext)
            path_to_id[path_without_ext] = note_meta.id
            
            nodes.append({
                "id": path_without_ext,
                "title": note_meta.title,
                "path": note_meta.id,  # Use id (without .md) for routing
                "tags": note_meta.tags,
                "type": note_meta.type
            })
        
        # Get full note data for each note to extract links
        for note_meta in notes_metadata:
            note = markdown_service.get_note(note_meta.id)
            if note and note.links:
                source_path = note.path.replace('.md', '')
                for link in note.links:
                    # Only create links if both nodes exist
                    if link in node_ids:
                        links.append({
                            "source": source_path,
                            "target": link
                        })
        
        return {
            "nodes": nodes,
            "links": links
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error generating graph: {str(e)}")
