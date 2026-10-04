import asyncio
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from models.sheet import SheetCatalogEntry, SheetSummary
from routes.auth import require_auth
from services import sheet_catalog
from services.sheet_parser import SHEET_TYPES

# The sheets of every character and adversary, read: what encounters are filled
# from. Behind login, like the documents they are.
router = APIRouter(prefix="/api/sheets", tags=["sheets"], dependencies=[Depends(require_auth)])


def _summary(entry: SheetCatalogEntry) -> SheetSummary:
    sheet = entry.sheet
    return SheetSummary(
        ref=entry.ref, id=sheet.id, name=sheet.name, type=entry.type, subtitle=sheet.subtitle,
        image=sheet.image, tags=sheet.tags, resources=sheet.resources,
        folder=entry.ref.rpartition("/")[0], warnings=entry.warnings,
    )


def _matches(entry: SheetCatalogEntry, query: str) -> bool:
    sheet = entry.sheet
    haystack = [sheet.name, sheet.subtitle or "", entry.ref, *sheet.tags]
    return any(query in text.lower() for text in haystack)


def _check_type(type: Optional[str]) -> None:
    if type is not None and type not in SHEET_TYPES:
        raise HTTPException(status_code=400, detail=f"type must be one of: {', '.join(SHEET_TYPES)}")


@router.get("", response_model=List[SheetSummary])
async def list_sheets(search: Optional[str] = Query(None), type: Optional[str] = Query(None)):
    _check_type(type)
    query = (search or "").strip().lower()
    entries = await asyncio.to_thread(sheet_catalog.list_sheets, type)
    return [_summary(entry) for entry in entries if not query or _matches(entry, query)]


# The ref goes in the query string: a document id has slashes (its folders).
@router.get("/detail", response_model=SheetCatalogEntry)
async def get_sheet(type: str = Query(...), ref: str = Query(...)):
    _check_type(type)
    entry = await asyncio.to_thread(sheet_catalog.get_sheet, type, ref)
    if entry is None:
        raise HTTPException(status_code=404, detail=f"Sheet not found: {type}:{ref}")
    return entry
