from fastapi import APIRouter, HTTPException, Query
from pathlib import Path
from typing import List, Optional
from models.note import Note, NoteMetadata
from services.markdown_service import MarkdownService
from config.settings import settings
from config.logging import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/api", tags=["notes"])

# Inicializar el servicio - singleton que usa configuración centralizada
markdown_service = MarkdownService(
    vault_path=str(settings.VAULT_PATH),
    repo_url=settings.REPO_URL,
    ignore_tag=settings.NOTE_TAG_IGNORE
)


@router.get("/notes", response_model=List[NoteMetadata])
async def get_all_notes(
    search: Optional[str] = Query(None, description="Buscar por título (fuzzy matching)"),
    tags: Optional[str] = Query(None, description="Filtrar por tags (separados por coma)"),
    limit: int = Query(50, ge=1, le=500, description="Máximo 500 notas por página"),
    offset: int = Query(0, ge=0, description="Offset para paginación")
):
    """
    Obtiene notas del vault con paginación y búsqueda fuzzy.
    
    Parámetros:
    - **search**: Búsqueda fuzzy por título (matchea parcialmente)
    - **tags**: Filtro por tags (separa múltiples con comas)
    - **limit**: Cantidad de notas por página (default 50, máximo 500)
    - **offset**: Offset para paginación (default 0)
    
    Ejemplo: GET /api/notes?search=Wei&tags=campaign&limit=25&offset=0
    """
    try:
        all_notes = markdown_service.get_all_notes()
        
        # Filtrar por búsqueda (fuzzy matching)
        if search:
            from fuzzywuzzy import fuzz
            all_notes = [
                n for n in all_notes
                if fuzz.token_set_ratio(search.lower(), n.title.lower()) > 60
            ]
            logger.debug(f"Fuzzy search for '{search}' returned {len(all_notes)} notes")
        
        # Filtrar por tags
        if tags:
            tag_list = [t.strip().lower() for t in tags.split(',') if t.strip()]
            all_notes = [
                n for n in all_notes
                if any(t.lower() in [nt.lower() for nt in n.tags] for t in tag_list)
            ]
            logger.debug(f"Tag filter for {tag_list} returned {len(all_notes)} notes")
        
        # Paginación
        total = len(all_notes)
        paginated = all_notes[offset:offset + limit]
        
        logger.info(f"get_all_notes: returned {len(paginated)} of {total} notes (offset={offset}, limit={limit})")
        
        return paginated
    except Exception as e:
        logger.error(f"Error getting notes: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error getting notes: {str(e)}")


@router.get("/note/{note_path:path}", response_model=Note)
async def get_note(note_path: str):
    """
    Obtiene una nota específica por su path relativo con validación de seguridad.
    Previene ataques de path traversal validando que la ruta esté dentro del vault.
    
    Ejemplo: /api/note/Carpeta/Mi Nota
    """
    # Normalizar path
    normalized_path = note_path.strip('/')
    
    # Validar que no intente path traversal
    try:
        full_path = (Path(markdown_service.vault_path) / f"{normalized_path}.md").resolve()
        vault_resolved = Path(markdown_service.vault_path).resolve()
        
        # Verificar que el archivo esté dentro del vault
        full_path.relative_to(vault_resolved)
    except (ValueError, RuntimeError):
        logger.warning(f"Path traversal attempt detected: {note_path}")
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
    """
    Sincroniza el vault con el repositorio remoto (pull o clone)
    """
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
    """
    Obtiene todos los tags únicos del vault ordenados alfabéticamente.
    """
    try:
        return markdown_service.get_all_tags()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error getting tags: {str(e)}")


@router.get("/container-folders", response_model=List[str])
async def get_container_folders():
    """
    Obtiene la lista de carpetas que son 'contenedoras' (no tienen nota índice).
    Estas son carpetas que solo contienen otras carpetas/notas, pero no tienen
    un archivo Carpeta/Carpeta.md que las represente.
    
    Útil para el frontend para saber qué carpetas no deben convertirse en links.
    """
    try:
        all_notes = markdown_service.get_all_notes()
        all_note_ids = set(n.id for n in all_notes)
        
        # Encontrar todas las carpetas que aparecen en los paths
        folders_found = set()
        for note_id in all_note_ids:
            parts = note_id.split('/')
            # Agregar cada nivel de carpeta excepto el último (que es la nota)
            for i in range(len(parts) - 1):
                folder_path = '/'.join(parts[:i + 1])
                folders_found.add(folder_path)
        
        # Encontrar carpetas contenedoras: carpetas cuyo path no tiene una nota correspondiente
        # Ej: si existe "Factions/Drunaris" como nota, entonces "Factions" es contenedora
        # pero si existe "Factions/Factions" como nota, entonces "Factions" NO es contenedora
        container_folders = set()
        for folder in folders_found:
            if folder not in all_note_ids:
                container_folders.add(folder.split('/')[-1])  # Solo el nombre de la carpeta
        
        return sorted(list(container_folders))
    except Exception as e:
        logger.error(f"Error getting container folders: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error getting container folders: {str(e)}")


@router.get("/vault/info")
async def get_vault_info():
    """Información sobre el vault actual"""
    notes = markdown_service.get_all_notes()
    
    return {
        "vault_path": str(markdown_service.vault_path),
        "total_notes": len(notes),
        "repo_url": settings.REPO_URL,
        "has_git": (markdown_service.vault_path / '.git').exists()
    }


@router.get("/graph/all")
async def get_graph_data():
    """
    Obtiene datos del grafo completo de todas las notas y sus wikilinks.
    Optimizado para alto rendimiento: extrae links sin cargar contenido completo.
    """
    try:
        # Get metadata for all notes (single pass)
        notes_metadata = markdown_service.get_all_notes()
        
        # Create nodes and build lookup maps
        nodes = []
        node_ids = set()  # Set de IDs (paths)
        title_to_id = {}  # Map de título a ID para resolver wikilinks
        
        for note_meta in notes_metadata:
            node_ids.add(note_meta.id)
            # Map título a ID para resolver wikilinks por título
            title_to_id[note_meta.title] = note_meta.id
            
            nodes.append({
                "id": note_meta.id,
                "title": note_meta.title,
                "path": note_meta.id,
                "tags": note_meta.tags,
                "type": note_meta.type
            })
        
        # Extract links efficiently (single pass, no full note load)
        links = []
        links_set = set()  # Para evitar duplicados
        
        for note_meta in notes_metadata:
            # Get only the links without loading full note content
            wikilinks = markdown_service.get_note_links_only(note_meta.id)
            
            for link in wikilinks:
                # Intentar resolver el link de 3 formas:
                # 1. Directo por ID
                # 2. Por título exacto
                # 3. Por coincidencia parcial del título
                target_id = None
                
                if link in node_ids:
                    # Match directo con ID
                    target_id = link
                elif link in title_to_id:
                    # Match con título exacto
                    target_id = title_to_id[link]
                else:
                    # Buscar por coincidencia de título (case-insensitive)
                    link_lower = link.lower()
                    for title, note_id in title_to_id.items():
                        if title.lower() == link_lower:
                            target_id = note_id
                            break
                
                # Create link si el target existe
                if target_id:
                    link_key = (note_meta.id, target_id)
                    if link_key not in links_set:
                        links_set.add(link_key)
                        links.append({
                            "source": note_meta.id,
                            "target": target_id
                        })
        
        logger.info(f"Graph data generated: {len(nodes)} nodes, {len(links)} links")
        
        return {
            "nodes": nodes,
            "links": links
        }
    except Exception as e:
        logger.error(f"Error generating graph: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error generating graph: {str(e)}")

