from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from models.sheet import SheetCatalogEntry, SheetSummary
from routes.notes import get_markdown_service
from services.markdown_service import MarkdownService
from services.sheet_parser import SHEET_TYPES

router = APIRouter(prefix="/api/sheets", tags=["sheets"])


def _summary(entry: SheetCatalogEntry) -> SheetSummary:
    sheet = entry.sheet
    return SheetSummary(
        ref=entry.ref, id=sheet.id, name=sheet.name, type=sheet.type, subtitle=sheet.subtitle,
        image=sheet.image, tags=sheet.tags, resources=sheet.resources,
        note_id=entry.note_id, note_title=entry.note_title, warnings=entry.warnings,
    )


def _matches(entry: SheetCatalogEntry, query: str) -> bool:
    sheet = entry.sheet
    haystack = [sheet.name, sheet.subtitle or "", entry.note_title, *sheet.tags]
    return any(query in text.lower() for text in haystack)


# Public, like the notes they are written in: a note hidden by the ignore tag
# contributes no sheets (MarkdownService builds the catalog from visible notes).
@router.get("", response_model=List[SheetSummary])
async def list_sheets(
    search: Optional[str] = Query(None),
    type: Optional[str] = Query(None),
    service: MarkdownService = Depends(get_markdown_service),
):
    if type is not None and type not in SHEET_TYPES:
        raise HTTPException(status_code=400, detail=f"type must be one of: {', '.join(SHEET_TYPES)}")
    query = (search or "").strip().lower()
    entries = service.get_sheets()
    return [
        _summary(entry) for entry in entries
        if (type is None or entry.sheet.type == type) and (not query or _matches(entry, query))
    ]


# The ref goes in the query string: an adversary's is "<note id>#<sheet id>",
# and a '#' (or the '/' of a note id) is awkward to carry in a path.
@router.get("/detail", response_model=SheetCatalogEntry)
async def get_sheet(ref: str = Query(...), service: MarkdownService = Depends(get_markdown_service)):
    entry = service.get_sheet(ref)
    if entry is None:
        raise HTTPException(status_code=404, detail=f"Sheet not found: {ref}")
    return entry
