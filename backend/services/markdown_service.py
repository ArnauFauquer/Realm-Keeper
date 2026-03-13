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
        
        self.vault_path.mkdir(parents=True, exist_ok=True)
    
    def sync_repository(self) -> bool:
        if not self.repo_url:
            return False
        
        try:
            git_dir = self.vault_path / '.git'
            
            if git_dir.exists() and git_dir.is_dir():
                repo = Repo(self.vault_path)
                origin = repo.remotes.origin
                origin.pull()
            else:
                if self.vault_path.exists():
                    files = list(self.vault_path.iterdir())
                    if files:
                        import shutil
                        for item in files:
                            if item.is_file():
                                item.unlink()
                            elif item.is_dir():
                                shutil.rmtree(item)
                
                try:
                    Repo.clone_from(self.repo_url, self.vault_path)
                except Exception as clone_error:
                    logger.warning(f"Clone with token failed: {clone_error}")
                    import re
                    url_without_token = re.sub(r'https://[^@]+@', 'https://', self.repo_url)
                    if url_without_token != self.repo_url:
                        Repo.clone_from(url_without_token, self.vault_path)
                    else:
                        raise
            
            self.invalidate_cache()
            return True
        except Exception as e:
            logger.error(f"Error syncing repository: {e}", exc_info=True)
            return False
    
    def get_all_notes(self) -> List[NoteMetadata]:
        notes = []
        
        for md_file in self.vault_path.rglob('*.md'):
            if any(part.startswith('.') for part in md_file.parts):
                continue
            
            relative_path = md_file.relative_to(self.vault_path)
            note_id = str(relative_path.with_suffix(''))
            
            try:
                fm, content, tags, _ = self.parser.parse_file(md_file)
                
                title = fm.get('title', md_file.stem)
                note_type = fm.get('type', None)
                
                if self.ignore_tag and self.ignore_tag in tags:
                    continue
                
                notes.append(NoteMetadata(
                    id=note_id.replace('\\', '/'),
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
        else:
            self._cache.clear()
    
    def get_all_tags(self) -> List[str]:
        tags = set()
        
        for note_meta in self.get_all_notes():
            tags.update(note_meta.tags)
        
        return sorted(list(tags), key=str.lower)
    
    def get_note_links_only(self, note_id: str) -> List[str]:
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
