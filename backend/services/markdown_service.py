import os
import re
from pathlib import Path
from typing import List, Optional, Dict
from datetime import datetime, timedelta
from git import Repo
from models.note import Note, NoteMetadata
from services.markdown_parser import MarkdownParser
from config.logging import get_logger

logger = get_logger(__name__)


class MarkdownService:
    """Servicio para gestionar el vault de Markdown"""
    
    def __init__(self, vault_path: str, repo_url: Optional[str] = None, ignore_tag: Optional[str] = None):
        self.vault_path = Path(vault_path)
        self.repo_url = repo_url
        self.ignore_tag = ignore_tag
        self.parser = MarkdownParser(vault_path=self.vault_path)
        
        # Cache con TTL
        self._cache: Dict[str, tuple] = {}  # {note_id: (Note, timestamp)}
        self._cache_ttl: timedelta = timedelta(minutes=5)  # 5 minutos de TTL
        
        # Crear directorio si no existe
        self.vault_path.mkdir(parents=True, exist_ok=True)
    
    def sync_repository(self) -> bool:
        """Clona o actualiza el repositorio"""
        if not self.repo_url:
            return False
        
        try:
            git_dir = self.vault_path / '.git'
            
            if git_dir.exists() and git_dir.is_dir():
                # Ya es un repositorio - hacer pull
                repo = Repo(self.vault_path)
                origin = repo.remotes.origin
                origin.pull()
                logger.info(f"Successfully pulled changes from {self.repo_url}")
            else:
                # No es un repositorio git
                # Verificar si el directorio existe y tiene contenido
                if self.vault_path.exists():
                    # Si tiene archivos, hacer backup y limpiar
                    files = list(self.vault_path.iterdir())
                    if files:
                        logger.info(f"Vault directory has {len(files)} files, will be replaced by clone")
                        # Eliminar archivos existentes para clonar limpio
                        import shutil
                        for item in files:
                            if item.is_file():
                                item.unlink()
                            elif item.is_dir():
                                shutil.rmtree(item)
                
                # Intentar clonar el repositorio
                logger.info(f"Cloning repository from {self.repo_url}")
                try:
                    Repo.clone_from(self.repo_url, self.vault_path)
                    logger.info("Repository cloned successfully")
                except Exception as clone_error:
                    # Si falla con token, intentar sin token (por si es público)
                    logger.warning(f"Clone with token failed: {clone_error}")
                    # Extraer URL sin credenciales
                    import re
                    url_without_token = re.sub(r'https://[^@]+@', 'https://', self.repo_url)
                    if url_without_token != self.repo_url:
                        logger.info(f"Retrying without token: {url_without_token}")
                        Repo.clone_from(url_without_token, self.vault_path)
                        logger.info("Repository cloned successfully (without token)")
                    else:
                        raise
            
            # Invalidar cache después de sync
            self.invalidate_cache()
            return True
        except Exception as e:
            logger.error(f"Error syncing repository: {e}", exc_info=True)
            return False
    
    def get_all_notes(self) -> List[NoteMetadata]:
        """Obtiene metadata de todas las notas manteniendo estructura de directorios"""
        notes = []
        
        for md_file in self.vault_path.rglob('*.md'):
            # Ignorar archivos en .git u otras carpetas ocultas
            if any(part.startswith('.') for part in md_file.parts):
                continue
            
            # Path relativo al vault (mantiene estructura de directorios)
            relative_path = md_file.relative_to(self.vault_path)
            note_id = str(relative_path.with_suffix(''))
            
            try:
                # Parse solo para metadata
                fm, content, tags, _ = self.parser.parse_file(md_file)
                
                # Título desde frontmatter o nombre del archivo
                title = fm.get('title', md_file.stem)
                note_type = fm.get('type', None)
                
                # Skip notes with ignored tag
                if self.ignore_tag and self.ignore_tag in tags:
                    continue
                
                notes.append(NoteMetadata(
                    id=note_id.replace('\\', '/'),  # Normalizar a forward slashes
                    title=title,
                    path=str(relative_path).replace('\\', '/'),
                    tags=tags,
                    type=note_type
                ))
            except Exception as e:
                logger.error(f"Error processing {md_file}: {e}", exc_info=True)
                continue
        
        return sorted(notes, key=lambda x: x.path)
    
    def _is_cache_valid(self, cached_at: datetime) -> bool:
        """Verificar si entrada de caché sigue siendo válida"""
        return datetime.now() - cached_at < self._cache_ttl
    
    def get_note(self, note_id: str) -> Optional[Note]:
        """Obtiene una nota específica por su ID (path relativo) con caché con TTL"""
        # Normalizar el note_id
        note_id = note_id.replace('/', os.sep)
        
        # Revisar cache
        if note_id in self._cache:
            note, cached_at = self._cache[note_id]
            if self._is_cache_valid(cached_at):
                return note
            else:
                # Invalidar entrada expirada
                del self._cache[note_id]
        
        # Construir path completo
        note_path = self.vault_path / f"{note_id}.md"
        
        if not note_path.exists():
            return None
        
        try:
            fm, content, tags, notelinks = self.parser.parse_file(note_path)
            
            title = fm.get('title', note_path.stem)
            
            note = Note(
                id=note_id.replace('\\', '/'),
                title=title,
                path=str(note_path.relative_to(self.vault_path)).replace('\\', '/'),
                content=content,
                frontmatter=fm,
                tags=tags,
                links=notelinks
            )
            
            # Guardar en caché con timestamp
            self._cache[note_id] = (note, datetime.now())
            return note
            
        except Exception as e:
            logger.error(f"Error reading note {note_id}: {e}", exc_info=True)
            return None
    
    def invalidate_cache(self, note_id: Optional[str] = None) -> None:
        """Invalidar caché para una nota específica o todo el caché"""
        if note_id:
            # Invalidar nota específica
            note_id_normalized = note_id.replace('/', os.sep)
            self._cache.pop(note_id_normalized, None)
            logger.debug(f"Invalidated cache for note: {note_id}")
        else:
            # Invalidar todo el caché
            self._cache.clear()
            logger.debug("Cleared entire cache")
    
    def get_all_tags(self) -> List[str]:
        """Obtiene todos los tags únicos del vault ordenados alfabéticamente"""
        tags = set()
        
        for note_meta in self.get_all_notes():
            tags.update(note_meta.tags)
        
        return sorted(list(tags), key=str.lower)
    
    def get_note_links_only(self, note_id: str) -> List[str]:
        """
        Extrae links (wikilinks) de una nota sin cargar el contenido completo.
        Más eficiente que get_note() cuando solo necesitas los links.
        
        Args:
            note_id: ID de la nota (path relativo)
            
        Returns:
            Lista de wikilinks encontrados en la nota
        """
        note_id_normalized = note_id.replace('/', os.sep)
        note_path = self.vault_path / f"{note_id_normalized}.md"
        
        if not note_path.exists():
            return []
        
        try:
            content = note_path.read_text(encoding='utf-8')
            
            # Skip frontmatter (si empieza con ---)
            if content.startswith('---'):
                # Encontrar el segundo --- que cierra el frontmatter
                parts = content.split('---', 2)
                if len(parts) >= 3:
                    content = parts[2]
            
            # Extraer wikilinks: [[link]] o [[link|title]]
            wikilinks = re.findall(r'\[\[([^\]|]+)', content)
            
            # Limpiar y normalizar links (remover espacios y normalizar separadores)
            cleaned_links = []
            for link in wikilinks:
                link = link.strip()
                if link:
                    cleaned_links.append(link)
            
            return cleaned_links
            
        except Exception as e:
            logger.warning(f"Error reading links from {note_id}: {e}")
            return []

