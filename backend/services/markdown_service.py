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
    def __init__(self, vault_path: str, repo_url: Optional[str] = None, ignore_tag: Optional[str] = None):
        self.vault_path = Path(vault_path)
        self.repo_url = repo_url
        self.ignore_tag = ignore_tag
        self.parser = MarkdownParser(vault_path=self.vault_path)
        
        self._cache: Dict[str, tuple] = {}
        self._cache_ttl: timedelta = timedelta(minutes=5)
        
        self._all_notes_cache: Optional[List[NoteMetadata]] = None
        self._all_notes_cached_at: Optional[datetime] = None
        
        self.vault_path.mkdir(parents=True, exist_ok=True)
    
    def sync_repository(self) -> bool:
        if not self.repo_url:
            return False
        
        try:
            if (self.vault_path / '.git').exists():
                Repo(self.vault_path).remotes.origin.pull()
            else:
                import shutil
                if self.vault_path.exists():
                    shutil.rmtree(self.vault_path)
                Repo.clone_from(self.repo_url, self.vault_path)
            
            self.invalidate_cache()
            return True
        except Exception as e:
            logger.error(f"Sync failed: {e}")
            return False
    
    def get_all_notes(self) -> List[NoteMetadata]:
        if self._all_notes_cache is not None and self._all_notes_cached_at is not None:
            if self._is_cache_valid(self._all_notes_cached_at):
                return self._all_notes_cache
                
        notes = []
        
        for md_file in self.vault_path.rglob('*.md'):
            if any(part.startswith('.') for part in md_file.parts):
                continue
            
            relative_path = md_file.relative_to(self.vault_path)
            note_id = str(relative_path.with_suffix(''))
            
            try:
                fm, content, tags, wikilinks = self.parser.parse_file(md_file)
                
                title = fm.get('title', md_file.stem)
                note_type = fm.get('type', None)
                
                if self.ignore_tag and self.ignore_tag in tags:
                    continue
                
                notes.append(NoteMetadata(
                    id=note_id.replace('\\', '/'),
                    title=title,
                    path=str(relative_path).replace('\\', '/'),
                    tags=tags,
                    type=note_type,
                    links=wikilinks
                ))
            except Exception as e:
                logger.error(f"Error processing {md_file}: {e}", exc_info=True)
                continue
        
        sorted_notes = sorted(notes, key=lambda x: x.path)
        self._all_notes_cache = sorted_notes
        self._all_notes_cached_at = datetime.now()
        return sorted_notes
    
    def _is_cache_valid(self, cached_at: datetime) -> bool:
        return datetime.now() - cached_at < self._cache_ttl
    
    def get_note(self, note_id: str) -> Optional[Note]:
        note_id = note_id.replace('/', os.sep)
        
        if note_id in self._cache:
            note, cached_at = self._cache[note_id]
            if self._is_cache_valid(cached_at):
                return note
            else:
                del self._cache[note_id]
        
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
            
            self._cache[note_id] = (note, datetime.now())
            return note
            
        except Exception as e:
            logger.error(f"Error reading note {note_id}: {e}", exc_info=True)
            return None
    
    def invalidate_cache(self, note_id: Optional[str] = None) -> None:
        if note_id:
            note_id_normalized = note_id.replace('/', os.sep)
            self._cache.pop(note_id_normalized, None)
            self._all_notes_cache = None
        else:
            self._cache.clear()
            self._all_notes_cache = None
            self.parser.invalidate_index()
    
    def get_all_tags(self) -> List[str]:
        tags = set()
        
        for note_meta in self.get_all_notes():
            tags.update(note_meta.tags)
        
        return sorted(list(tags), key=str.lower)
    
    def get_note_links_only(self, note_id: str) -> List[str]:
        """Reads a markdown file explicitly to extract missing wikilinks."""
        note_id_normalized = note_id.replace('/', os.sep)
        note_path = self.vault_path / f"{note_id_normalized}.md"
        
        if not note_path.exists():
            return []
        
        try:
            content = note_path.read_text(encoding='utf-8')
            
            if content.startswith('---'):
                parts = content.split('---', 2)
                if len(parts) >= 3:
                    content = parts[2]
            
            wikilinks = re.findall(r'\[\[([^\]|]+)', content)
            
            cleaned_links = []
            for link in wikilinks:
                link = link.strip()
                if link:
                    cleaned_links.append(link)
            
            return cleaned_links
            
        except Exception as e:
            return []

    def get_container_folders(self) -> List[str]:
        """Calculates and returns a sorted list of all container folders in the vault."""
        all_notes = self.get_all_notes()
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

    def get_graph_data(self) -> Dict:
        """Generates node and link data for the graph view based on note metadata and wikilinks."""
        notes_metadata = self.get_all_notes()
        
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
            wikilinks = note_meta.links
            
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
