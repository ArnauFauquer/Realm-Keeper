import os
from pathlib import Path
from typing import List, Optional, Dict
from git import Repo
from models.note import Note, NoteMetadata
from services.markdown_parser import MarkdownParser


class MarkdownService:
    """Servicio para gestionar el vault de Markdown"""
    
    def __init__(self, vault_path: str, repo_url: Optional[str] = None, ignore_tag: Optional[str] = None):
        self.vault_path = Path(vault_path)
        self.repo_url = repo_url
        self.ignore_tag = ignore_tag
        self.parser = MarkdownParser(vault_path=self.vault_path)
        self._cache: Dict[str, Note] = {}
        
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
                print(f"Successfully pulled changes from {self.repo_url}")
            else:
                # No es un repositorio git
                # Verificar si el directorio existe y tiene contenido
                if self.vault_path.exists():
                    # Si tiene archivos, hacer backup y limpiar
                    files = list(self.vault_path.iterdir())
                    if files:
                        print(f"Vault directory has {len(files)} files, will be replaced by clone")
                        # Eliminar archivos existentes para clonar limpio
                        import shutil
                        for item in files:
                            if item.is_file():
                                item.unlink()
                            elif item.is_dir():
                                shutil.rmtree(item)
                
                # Intentar clonar el repositorio
                print(f"Cloning repository from {self.repo_url}")
                try:
                    Repo.clone_from(self.repo_url, self.vault_path)
                    print("Repository cloned successfully")
                except Exception as clone_error:
                    # Si falla con token, intentar sin token (por si es público)
                    print(f"Clone with token failed: {clone_error}")
                    # Extraer URL sin credenciales
                    import re
                    url_without_token = re.sub(r'https://[^@]+@', 'https://', self.repo_url)
                    if url_without_token != self.repo_url:
                        print(f"Retrying without token: {url_without_token}")
                        Repo.clone_from(url_without_token, self.vault_path)
                        print("Repository cloned successfully (without token)")
                    else:
                        raise
            
            # Limpiar cache después de sync
            self._cache.clear()
            return True
        except Exception as e:
            print(f"Error syncing repository: {e}")
            import traceback
            traceback.print_exc()
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
                print(f"Error processing {md_file}: {e}")
                continue
        
        return sorted(notes, key=lambda x: x.path)
    
    def get_note(self, note_id: str) -> Optional[Note]:
        """Obtiene una nota específica por su ID (path relativo)"""
        # Normalizar el note_id
        note_id = note_id.replace('/', os.sep)
        
        # Revisar cache
        if note_id in self._cache:
            return self._cache[note_id]
        
        # Construir path completo
        note_path = self.vault_path / f"{note_id}.md"
        
        if not note_path.exists():
            return None
        
        try:
            fm, content, tags, wikilinks = self.parser.parse_file(note_path)
            
            title = fm.get('title', note_path.stem)
            
            note = Note(
                id=note_id.replace('\\', '/'),
                title=title,
                path=str(note_path.relative_to(self.vault_path)).replace('\\', '/'),
                content=content,
                frontmatter=fm,
                tags=tags,
                links=wikilinks
            )
            
            # Cache la nota
            self._cache[note_id] = note
            return note
            
        except Exception as e:
            print(f"Error reading note {note_id}: {e}")
            return None
    
    def search_notes(self, query: str) -> List[NoteMetadata]:
        """Busca notas por título o contenido"""
        query_lower = query.lower()
        results = []
        
        for note_meta in self.get_all_notes():
            if query_lower in note_meta.title.lower():
                results.append(note_meta)
        
        return results
    
    def get_all_tags(self) -> List[str]:
        """Obtiene todos los tags únicos del vault ordenados alfabéticamente"""
        tags = set()
        
        for note_meta in self.get_all_notes():
            tags.update(note_meta.tags)
        
        return sorted(list(tags), key=str.lower)
    
    def get_notes_by_tags(self, tag_list: List[str]) -> List[NoteMetadata]:
        """Filtra notas que contienen al menos uno de los tags especificados"""
        tag_list_lower = [t.lower() for t in tag_list]
        results = []
        
        for note_meta in self.get_all_notes():
            note_tags_lower = [t.lower() for t in note_meta.tags]
            if any(t in note_tags_lower for t in tag_list_lower):
                results.append(note_meta)
        
        return results
