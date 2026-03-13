import os
from pathlib import Path
from typing import List, Optional, Dict
from datetime import datetime, timedelta
from models.note import Note, NoteMetadata
from services.markdown_parser import MarkdownParser
from config.logging import get_logger

logger = get_logger(__name__)

class MarkdownService:
    def __init__(self, vault_path: str, ignore_tag: Optional[str] = None):
        self.vault_path = Path(vault_path)
        self.ignore_tag = ignore_tag
        self.parser = MarkdownParser(vault_path=self.vault_path)
        
        self._cache: Dict[str, tuple] = {}
        self._cache_ttl: timedelta = timedelta(minutes=5)
        
        self._all_notes_cache: Optional[List[NoteMetadata]] = None
        self._all_notes_cached_at: Optional[datetime] = None
        
        self.vault_path.mkdir(parents=True, exist_ok=True)
    
    def get_all_notes(self, search: Optional[str] = None, tags: Optional[str] = None) -> List[NoteMetadata]:
        # Simple caching for unfiltered notes
        if not search and not tags:
            if self._all_notes_cache is not None and self._all_notes_cached_at is not None:
                if self._is_cache_valid(self._all_notes_cached_at):
                    return self._all_notes_cache
                
        notes = []
        tag_list = [t.strip().lower() for t in tags.split(',') if t.strip()] if tags else []
        
        for md_file in self.vault_path.rglob('*.md'):
            if any(part.startswith('.') for part in md_file.parts):
                continue
            
            relative_path = md_file.relative_to(self.vault_path)
            note_id = str(relative_path.with_suffix('')).replace('\\', '/')
            
            try:
                fm, _, note_tags, wikilinks = self.parser.parse_file(md_file)
                
                if self.ignore_tag and self.ignore_tag in note_tags:
                    continue
                
                # Search filter
                title = fm.get('title', md_file.stem)
                if search:
                    query = search.lower()
                    if query not in title.lower() and query not in note_id.lower():
                        continue
                    
                # Tag filter
                if tag_list and not any(t in [nt.lower() for nt in note_tags] for t in tag_list):
                    continue

                notes.append(NoteMetadata(
                    id=note_id,
                    title=title,
                    path=str(relative_path).replace('\\', '/'),
                    tags=note_tags,
                    type=fm.get('type'),
                    links=wikilinks
                ))
            except Exception as e:
                logger.error(f"Error processing {md_file}: {e}")
                continue
        
        sorted_notes = sorted(notes, key=lambda x: x.path)
        
        if not search and not tags:
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
    
    def get_container_folders(self) -> Dict[str, Optional[str]]:
        """
        Returns a mapping of folder paths to their 'primary' note ID.
        If a folder has a note with the same name inside, that note ID is the value.
        Otherwise, if it's just a container, the value is None.
        """
        all_notes = self.get_all_notes()
        note_ids = {n.id for n in all_notes}
        
        folder_paths = set()
        for note in all_notes:
            p = Path(note.path).parent
            while str(p) != '.' and str(p) != '':
                folder_paths.add(str(p).replace('\\', '/'))
                p = p.parent
        
        mapping: Dict[str, Optional[str]] = {}
        for fp in folder_paths:
            # Check if this folder path itself is a note
            if fp in note_ids:
                mapping[fp] = fp
            else:
                # Check for namesake note: folder "Hijos Del Fango" -> note "Hijos Del Fango/Hijos Del Fango"
                folder_name = Path(fp).name
                expected_note_id = f"{fp}/{folder_name}"
                if expected_note_id in note_ids:
                    mapping[fp] = expected_note_id
                else:
                    mapping[fp] = None
                
        return mapping

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
