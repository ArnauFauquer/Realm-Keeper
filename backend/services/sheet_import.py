"""Sheets used to be written in notes, as ```sheet blocks; now each character
and adversary is a document of its own. This brings the old blocks over, once:

- a character becomes characters/<its id>, where its saved values already
  were (they are kept: the sheet joins them);
- an adversary becomes adversaries/<its note's folder>/<its id>, and the
  encounters and maps that named it as "<note id>#<id>" name it by that.

Nothing in the vault is touched by the import (it runs at startup, from the
pod's clone). Afterwards each block can be replaced by the link that shows the
document (`character:<id>`, `adversary:<id>`) with rewrite_notes, run on a
checkout of the vault: scripts/sheets_to_documents.py.
"""
import json
import logging
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, NamedTuple

from services.doc_registry import (
    ADVERSARY, CHARACTER, adversary_collection, battlemap_collection, characters_collection, encounter_collection,
)
from services.fences import FencedBlock, iter_fenced_blocks
from services.markdown_parser import MarkdownParser
from models.sheet import SheetSpec
from services.sheet_parser import DOCUMENT_FIELDS, SheetParseError, parse_sheet_source
from services.sheet_refs import rename_sheet_refs

logger = logging.getLogger(__name__)

MARKER = f"{adversary_collection.root}.imported-from-notes"
_DOCUMENT_FIELD_RE = re.compile(rf"^({'|'.join(DOCUMENT_FIELDS)})\s*:")
_QUOTE_PREFIX_RE = re.compile(r"^((?: {0,3}> ?)*)")


class NoteSheet(NamedTuple):
    note_path: Path   # the note's file
    note_id: str      # "Sistemas/Daggerheart/Adversarios/Bugboar"
    block: FencedBlock
    sheet: SheetSpec
    doc_id: str       # the document it becomes
    source: str       # its YAML, without what is now the document's

    @property
    def link(self) -> str:
        return f"`{self.sheet.type}:{self.doc_id}`"


def strip_document_fields(source: str) -> str:
    """The YAML without its top-level `id`, `name` and `type` (and the
    indented lines a value of theirs may go on with): a document has its own."""
    kept, skipping = [], False
    for line in source.split("\n"):
        if _DOCUMENT_FIELD_RE.match(line):
            skipping = True
            continue
        if skipping and line[:1] in (" ", "\t"):
            continue
        skipping = False
        kept.append(line)
    return "\n".join(kept).strip("\n") + "\n"


def find_note_sheets(vault_path: Path) -> List[NoteSheet]:
    """Every valid ```sheet block of the vault, with the document it becomes.
    The same in every run over the same notes: notes are read by path, and a
    character id met twice is the same character (the first block wins, as it
    did in the catalog), while two adversaries that would share an id get
    "-2", "-3"..."""
    found: List[NoteSheet] = []
    taken = set()
    vault_path = Path(vault_path)
    notes = {path.relative_to(vault_path).with_suffix("").as_posix(): path for path in MarkdownParser(vault_path).iter_note_files()}
    for note_id, path in sorted(notes.items()):
        text = path.read_text(encoding="utf-8")
        if "sheet" not in text:
            continue
        for block in iter_fenced_blocks(text):
            if block.lang != "sheet":
                continue
            try:
                sheet, _warnings = parse_sheet_source(block.content)
            except SheetParseError as e:
                logger.warning(f"Not importing an invalid sheet of {note_id}: {e}")
                continue
            if sheet.type == "character":
                doc_id = sheet.id
            else:
                folder = note_id.rpartition("/")[0]
                base = f"{folder}/{sheet.id}" if folder else sheet.id
                doc_id, n = base, 2
                while ("adversary", doc_id) in taken:
                    doc_id, n = f"{base}-{n}", n + 1
            taken.add((sheet.type, doc_id))
            found.append(NoteSheet(path, note_id, block, sheet, doc_id, strip_document_fields(block.content)))
    return found


def _import_character(found: NoteSheet) -> bool:
    existing = characters_collection.read_raw(found.doc_id)
    if existing is not None and existing.get("source"):
        return False  # already a sheet: a second block with the same id, or a run that stopped halfway
    data = {**(existing or {}), "id": found.doc_id, "name": found.sheet.name, "source": found.source}
    data.setdefault("rev", 0)
    CHARACTER.prepare(data, None)  # its counters, keeping the saved values
    characters_collection.write_raw(found.doc_id, CHARACTER.model.model_validate(data).model_dump(mode="json"))
    return True


def _import_adversary(found: NoteSheet) -> bool:
    if adversary_collection.read_raw(found.doc_id) is not None:
        return False
    data = {"id": found.doc_id, "name": found.sheet.name, "source": found.source}
    ADVERSARY.prepare(data, None)
    adversary_collection.write_raw(found.doc_id, ADVERSARY.model.model_validate(data).model_dump(mode="json"))
    return True


def _follow(moves: Dict[str, str]) -> int:
    """Encounters and maps that named an adversary by its note now name its
    document. Run before anything serves them (startup), so straight on the
    stored documents. Returns how many it changed."""
    changed = 0
    for collection, field, sheet_type in (
        (encounter_collection, "combatants", "adversary"), (battlemap_collection, "tokens", None),
    ):
        for meta in collection.list_all():
            doc = collection.read_raw(meta.id)
            before = json.dumps(doc.get(field, []))
            rename_sheet_refs(doc.get(field, []), moves, sheet_type)
            if json.dumps(doc.get(field, [])) != before:
                collection.write_raw(meta.id, doc)
                changed += 1
    return changed


def import_note_sheets(vault_path: Path) -> None:
    """Brings the vault's ```sheet blocks into the document store, if that has
    not been done. Non-destructive and resumable: a document that is already
    there is left as it is, and without the marker (a failed run) the next
    start tries again. A failure is logged, not fatal: the notes still work."""
    backend = adversary_collection.backend
    try:
        if backend.exists(MARKER):
            return
        sheets = find_note_sheets(vault_path)
        characters = sum(_import_character(s) for s in sheets if s.sheet.type == "character")
        adversaries = sum(_import_adversary(s) for s in sheets if s.sheet.type == "adversary")
        moves = {f"{s.note_id}#{s.sheet.id}": s.doc_id for s in sheets if s.sheet.type == "adversary"}
        followed = _follow(moves)
        backend.put(MARKER, json.dumps({
            "imported_at": datetime.now(timezone.utc).isoformat(),
            "characters": characters, "adversaries": adversaries, "documents_updated": followed,
        }))
        if sheets:
            logger.info(
                f"Imported the notes' sheets: {characters} characters, {adversaries} adversaries; "
                f"{followed} encounters and maps now name them by their documents"
            )
    except Exception:
        logger.exception("Could not import the sheets written in notes")


def rewrite_notes(vault_path: Path) -> List[Path]:
    """Replaces each ```sheet block of the vault by the link to the document it
    became (find_note_sheets decides it the same way the import did). Returns
    the notes it changed. Run it after the import, on a checkout of the vault."""
    by_note: Dict[Path, List[NoteSheet]] = {}
    for found in find_note_sheets(vault_path):
        by_note.setdefault(found.note_path, []).append(found)
    for path, sheets in by_note.items():
        lines = path.read_text(encoding="utf-8").split("\n")
        for found in sorted(sheets, key=lambda s: s.block.start, reverse=True):
            prefix = _QUOTE_PREFIX_RE.match(lines[found.block.start]).group(1)
            lines[found.block.start:found.block.end + 1] = [f"{prefix}{found.link}"]
        path.write_text("\n".join(lines), encoding="utf-8")
    return list(by_note)
