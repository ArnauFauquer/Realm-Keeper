import os
import re
import threading
from pathlib import Path
from typing import List, Optional, Dict
from datetime import datetime, timedelta
from models.note import Note, NoteMetadata
from services.markdown_parser import MarkdownParser
from services.git_sync_utils import commit_and_push, GitCommitError
from config.logging import get_logger

logger = get_logger(__name__)


class NoteSaveError(Exception):
    """Raised when writing a note to disk or to git fails."""
    pass


class MarkdownService:
    def __init__(self, vault_path: str, ignore_tag: Optional[str] = None):
        self.vault_path = Path(vault_path)
        self.ignore_tag = ignore_tag
        self.parser = MarkdownParser(vault_path=self.vault_path)

        self._cache: Dict[str, tuple] = {}
        self._cache_ttl: timedelta = timedelta(minutes=5)

        self._all_notes_cache: Optional[List[NoteMetadata]] = None
        self._all_notes_cached_at: Optional[datetime] = None

        self._git_lock = threading.Lock()

        self.vault_path.mkdir(parents=True, exist_ok=True)

    def _resolve_note_path(self, note_id: str) -> Path:
        """Validate a note id and resolve it to a path guaranteed to stay
        inside the vault. Raises ValueError on any traversal/invalid segment."""
        normalized = note_id.strip('/')
        if not normalized:
            raise ValueError("Note path cannot be empty")

        for segment in normalized.split('/'):
            # Dot-prefixed covers ".", ".." and hidden dirs such as .git,
            # which get_all_notes() never lists either.
            if not segment or segment.startswith('.') or '\\' in segment or '\x00' in segment:
                raise ValueError(f"Invalid note path segment: {segment!r}")

        full_path = (self.vault_path / f"{normalized}.md").resolve()
        vault_resolved = self.vault_path.resolve()
        try:
            full_path.relative_to(vault_resolved)
        except ValueError:
            raise ValueError("Access denied: path must be within vault")

        return full_path

    def is_hidden(self, tags: List[str]) -> bool:
        """Notes carrying the ignore tag are hidden from the app entirely —
        not only from listings, but from direct reads by id too. That makes
        this an access check, so it errs towards hiding: case-insensitive
        (Obsidian treats #Draft and #draft as one tag), nested tags count
        (#draft/wip), and a frontmatter string like `tags: "draft, npc"`
        is split rather than taken as a single tag."""
        if not self.ignore_tag:
            return False
        ignore = self.ignore_tag.strip().lstrip('#').lower()
        for tag in tags:
            for part in re.split(r'[,\s]+', str(tag)):
                part = part.strip().lstrip('#').lower()
                if part == ignore or part.startswith(f"{ignore}/"):
                    return True
        return False

    def get_raw_content(self, note_id: str) -> Optional[str]:
        """Returns the note's file content verbatim (frontmatter and
        [[wikilinks]] untouched), for editing — as opposed to get_note()'s
        content, which is transformed for rendering."""
        note_path = self._resolve_note_path(note_id)
        if not note_path.exists():
            return None
        return note_path.read_text(encoding='utf-8')

    def save_note(self, note_id: str, content: str, author_name: str, author_email: str) -> bool:
        """Writes a note's raw markdown to disk and commits + pushes it to
        the vault's git repo. Returns True if this created a new note, False
        if it updated an existing one. Raises NoteSaveError on git failure."""
        note_path = self._resolve_note_path(note_id)
        is_new = not note_path.exists()

        note_path.parent.mkdir(parents=True, exist_ok=True)
        note_path.write_text(content, encoding='utf-8')
        rel_path = str(note_path.relative_to(self.vault_path.resolve()))

        verb = "Create" if is_new else "Update"
        try:
            commit_and_push(
                self.vault_path, self._git_lock, [rel_path],
                message=f"{verb} note: {note_id}",
                author_name=author_name, author_email=author_email,
            )
        except GitCommitError as e:
            raise NoteSaveError(str(e))

        self.invalidate_cache()
        return is_new
    
    def get_all_notes(self, search: Optional[str] = None, tags: Optional[str] = None) -> List[NoteMetadata]:
        # Simple caching for unfiltered notes
        if not search and not tags:
            if self._all_notes_cache is not None and self._all_notes_cached_at is not None:
                if self._is_cache_valid(self._all_notes_cached_at):
                    return self._all_notes_cache
                
        notes = []
        hidden_ids = set()
        tag_list = [t.strip().lower() for t in tags.split(',') if t.strip()] if tags else []

        for md_file in self.parser.iter_note_files():
            relative_path = md_file.relative_to(self.vault_path)
            note_id = str(relative_path.with_suffix('')).replace('\\', '/')

            try:
                fm, _, note_tags, wikilinks = self.parser.parse_file(md_file)

                if self.is_hidden(note_tags):
                    hidden_ids.add(note_id)
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
        
        # Every file was scanned (filters apply after the hidden check), so this
        # is the complete hidden set: strip links that would reveal where a
        # hidden note lives, and let the parser do the same for rendered
        # wikilinks in get_note().
        self.parser.hidden_ids = hidden_ids
        for note in notes:
            note.links = [link for link in note.links if link not in hidden_ids]

        sorted_notes = sorted(notes, key=lambda x: x.path)

        if not search and not tags:
            self._all_notes_cache = sorted_notes
            self._all_notes_cached_at = datetime.now()
            
        return sorted_notes
    
    def _is_cache_valid(self, cached_at: datetime) -> bool:
        return datetime.now() - cached_at < self._cache_ttl
    
    def get_note(self, note_id: str) -> Optional[Note]:
        try:
            self._resolve_note_path(note_id)
        except ValueError:
            return None
        note_id = note_id.strip('/').replace('/', os.sep)
        
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
            # Refreshes the hidden set (cached like the listing) before this
            # note's wikilinks are resolved against it.
            self.get_all_notes()
            fm, content, tags, notelinks = self.parser.parse_file(note_path)
            if self.is_hidden(tags):
                return None

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
