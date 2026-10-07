import hashlib
import os
import re
import threading
from pathlib import Path
from typing import Callable, List, Optional, Dict, Tuple, TypeVar
from datetime import datetime, timedelta
from models.note import Note, NoteMetadata
from services.markdown_parser import MarkdownParser
from services.git_sync_utils import commit_and_push, GitCommitError
from config.logging import get_logger

logger = get_logger(__name__)

T = TypeVar("T")

# The home page, when HOME_NOTE doesn't name one: the first of these the vault
# has at its top (any case). "RealmKeeper" first, the home page before it
# could be chosen.
HOME_NOTE_CANDIDATES = ("RealmKeeper", "index", "Home", "README", "Welcome")


class NoteSaveError(Exception):
    """Raised when writing a note to disk or to git fails."""
    pass


class NoteConflict(Exception):
    """The note changed since the editor loaded it (someone else saved it, a
    pull brought an Obsidian edit), or a note meant to be new already exists."""
    pass


def content_sha(text: str) -> str:
    """What a note's content is known by when it is saved back: the editor
    sends the one it loaded, and a save over anything else is a conflict."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


class MarkdownService:
    def __init__(self, vault_path: str, ignore_tag: Optional[str] = None, git: bool = True):
        self.vault_path = Path(vault_path)
        self.ignore_tag = ignore_tag
        # Whether what the app writes is committed and pushed (GIT_ENABLED),
        # or only written to disk.
        self.git = git
        self.parser = MarkdownParser(vault_path=self.vault_path)

        self._cache: Dict[str, tuple] = {}
        self._cache_ttl: timedelta = timedelta(minutes=5)

        self._all_notes_cache: Optional[List[NoteMetadata]] = None
        self._all_notes_cached_at: Optional[datetime] = None

        # Everything that writes the vault or runs git in it (a note saved,
        # links followed, the periodic pull) holds this, so they never
        # interleave. Re-entrant: a save holds it while it writes the file and
        # commit_and_push takes it again.
        self._git_lock = threading.RLock()

        self.vault_path.mkdir(parents=True, exist_ok=True)

    def under_git_lock(self, fn: Callable[[], T]) -> T:
        with self._git_lock:
            return fn()

    def _commit(self, rel_paths: List[str], message: str, author_name: str, author_email: str) -> None:
        """Commits and pushes what was just written, if the vault is in git.
        Raises NoteSaveError."""
        if not self.git:
            return
        try:
            commit_and_push(self.vault_path, self._git_lock, rel_paths, message=message,
                            author_name=author_name, author_email=author_email)
        except GitCommitError as e:
            raise NoteSaveError(str(e))

    def fingerprint(self) -> str:
        """What the vault's notes are, by name, size and time written: changes
        when anything outside the app (Obsidian on a shared folder) writes,
        adds, moves or deletes one. Cheap: a stat of each, no reading."""
        digest = hashlib.sha1()
        for path in sorted(self.parser.iter_note_files()):
            try:
                stat = path.stat()
            except OSError:
                continue   # deleted while listed
            digest.update(f"{path}\0{stat.st_size}\0{stat.st_mtime_ns}\n".encode("utf-8", "surrogateescape"))
        return digest.hexdigest()

    @staticmethod
    def check_note_id(note_id: str) -> str:
        """A note id, normalized, if it could name a note: no empty, hidden
        (".", "..", ".git") or backslashed segment. Raises ValueError. Says
        nothing of whether the note exists (or, through a symlink, resolves
        outside the vault: that one simply isn't a note, see get_note)."""
        normalized = note_id.strip('/')
        if not normalized:
            raise ValueError("Note path cannot be empty")

        for segment in normalized.split('/'):
            # Dot-prefixed covers ".", ".." and hidden dirs such as .git,
            # which get_all_notes() never lists either.
            if not segment or segment.startswith('.') or '\\' in segment or '\x00' in segment:
                raise ValueError(f"Invalid note path segment: {segment!r}")
        return normalized

    def _resolve_note_path(self, note_id: str) -> Path:
        """Validate a note id and resolve it to a path guaranteed to stay
        inside the vault. Raises ValueError on any traversal/invalid segment."""
        normalized = self.check_note_id(note_id)

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

    def save_note(
        self, note_id: str, content: str, author_name: str, author_email: str,
        base_sha: Optional[str] = None,
    ) -> Tuple[bool, str]:
        """Writes a note's raw markdown to disk and, with git on, commits +
        pushes it to the vault's git repo. Returns whether this created a new note, and
        the saved content's sha. Raises NoteSaveError on git failure.

        `base_sha` is the content the editor started from (`content_sha`):
        if the note is no longer that, NoteConflict and nothing is written.
        "" means the note must not exist yet; None checks nothing."""
        note_path = self._resolve_note_path(note_id)
        with self._git_lock:
            exists = note_path.exists()
            current = note_path.read_text(encoding='utf-8') if exists else None
            if base_sha == "" and exists:
                raise NoteConflict("A note with this name already exists")
            if base_sha and (current is None or content_sha(current) != base_sha):
                raise NoteConflict("This note was changed by someone else since you opened it")
            if current == content:
                return False, content_sha(content)   # nothing to save, and nothing to commit

            note_path.parent.mkdir(parents=True, exist_ok=True)
            note_path.write_text(content, encoding='utf-8')
            rel_path = str(note_path.relative_to(self.vault_path.resolve()))

            verb = "Update" if exists else "Create"
            try:
                self._commit([rel_path], f"{verb} note: {note_id}", author_name, author_email)
            finally:
                # What is served is what is on disk, saved or not.
                self.invalidate_cache()
        return not exists, content_sha(content)

    def follow_moved_documents(self, kind: str, moves: Dict[str, str], author_name: str, author_email: str) -> List[str]:
        """Points the notes' links to moved documents (`chart:<id>`,
        `character:<id>`...) at their new ids, in one commit. Returns the ids
        of the notes it changed. Raises NoteSaveError on git failure (the
        files are already rewritten on disk by then)."""
        if not moves:
            return []
        # Read, rewritten and committed under the lock: a note saved in
        # between would otherwise be overwritten with the version read here.
        with self._git_lock:
            return self._follow_moved_documents(kind, moves, author_name, author_email)

    def _follow_moved_documents(self, kind: str, moves: Dict[str, str], author_name: str, author_email: str) -> List[str]:
        link = re.compile(rf"`(\s*)({re.escape(kind)}):([^`\n]+?)(\s*)`", re.IGNORECASE)

        def follow(match: re.Match) -> str:
            new_id = moves.get(match.group(3).strip("/"))
            return f"`{match.group(1)}{match.group(2)}:{new_id}{match.group(4)}`" if new_id else match.group(0)

        changed = []
        for path in self.parser.iter_note_files():
            text = path.read_text(encoding='utf-8')
            if f"{kind}:" not in text.lower():
                continue
            followed = link.sub(follow, text)
            if followed != text:
                path.write_text(followed, encoding='utf-8')
                changed.append(path)
        if not changed:
            return []

        vault = self.vault_path.resolve()
        rel_paths = [str(path.resolve().relative_to(vault)) for path in changed]
        what = next(iter(moves.items())) if len(moves) == 1 else None
        message = f"Follow moved {kind}: {what[0]} -> {what[1]}" if what else f"Follow {len(moves)} moved {kind}s"
        try:
            self._commit(rel_paths, message, author_name, author_email)
        finally:
            self.invalidate_cache()
        return [Path(rel).with_suffix('').as_posix() for rel in rel_paths]

    def get_all_notes(self, search: Optional[str] = None, tags: Optional[str] = None) -> List[NoteMetadata]:
        """Every visible note, by path; with `search`, those whose title or id
        holds it, and with `tags` (comma-separated) those with any of them.
        Filtered from the cached listing: a search doesn't parse the vault."""
        notes = self._all_notes()
        if search:
            query = search.lower()
            notes = [n for n in notes if query in n.title.lower() or query in n.id.lower()]
        tag_list = [t.strip().lower() for t in tags.split(',') if t.strip()] if tags else []
        if tag_list:
            notes = [n for n in notes if any(t in [nt.lower() for nt in n.tags] for t in tag_list)]
        return notes

    def _all_notes(self) -> List[NoteMetadata]:
        cached, cached_at = self._all_notes_cache, self._all_notes_cached_at
        if cached is not None and cached_at is not None and self._is_cache_valid(cached_at):
            return cached

        notes = []
        hidden_ids = set()

        for md_file in self.parser.iter_note_files():
            relative_path = md_file.relative_to(self.vault_path)
            note_id = str(relative_path.with_suffix('')).replace('\\', '/')

            try:
                parsed = self.parser.parse(md_file)
                fm, note_tags, wikilinks = parsed.frontmatter, parsed.tags, parsed.wikilinks

                if self.is_hidden(note_tags):
                    hidden_ids.add(note_id)
                    continue

                title = fm.get('title', md_file.stem)

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
        self._all_notes_cache, self._all_notes_cached_at = sorted_notes, datetime.now()
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
    
    def home_note(self, configured: str = "") -> Optional[str]:
        """The note the app opens on: `configured` (HOME_NOTE) if the vault
        has it, else the first of HOME_NOTE_CANDIDATES at the vault's top,
        else its first note at the top, else any. None for an empty vault."""
        visible = {n.id: n for n in self._all_notes()}
        if not visible:
            return None
        if configured in visible:
            return configured
        by_name = {note_id.lower(): note_id for note_id in visible if "/" not in note_id}
        for candidate in HOME_NOTE_CANDIDATES:
            if candidate.lower() in by_name:
                return by_name[candidate.lower()]
        top = sorted(by_name.values(), key=str.lower)
        return top[0] if top else sorted(visible, key=str.lower)[0]

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
