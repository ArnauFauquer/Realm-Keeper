"""What a character or adversary document gets from its sheet when it is
stored: what its gallery card shows (image, subtitle, tags) and, for a
character, counters that match the ones the sheet declares. A source that
isn't a valid sheet is refused, with the parser's message: what is stored is
always a sheet a note can show."""
from typing import Any, Dict, Optional

from services.sheet_parser import SheetParseError, parse_sheet_doc


def _counter(spec) -> Dict[str, Any]:
    return {
        "current": spec.max if spec.start is None else max(spec.min, min(spec.max, spec.start)),
        "max": spec.max, "min": spec.min, "color": spec.color, "style": spec.style,
    }


def fit_counters(saved: Dict[str, Any], specs: Dict[str, Any]) -> Dict[str, Any]:
    """The counters a sheet declares, keeping each one's current value (within
    its new range) when it was already there. A new counter starts where the
    sheet says; one the sheet no longer has is dropped (so renaming a counter
    starts it again)."""
    fitted = {}
    for name, spec in specs.items():
        counter = _counter(spec)
        current = (saved.get(name) or {}).get("current")
        if isinstance(current, int):
            counter["current"] = max(spec.min, min(spec.max, current))
        fitted[name] = counter
    return fitted


def sheet_preparer(sheet_type: str):
    """DocType.prepare for a kind of sheet document."""
    def prepare(doc: Dict[str, Any], previous: Optional[Dict[str, Any]]) -> None:
        if previous is not None and previous.get("source") == doc.get("source") and previous.get("name") == doc.get("name"):
            return
        try:
            sheet, _warnings = parse_sheet_doc(doc, sheet_type)
        except SheetParseError as e:
            raise ValueError(str(e))
        doc.update(image=sheet.image, subtitle=sheet.subtitle, tags=sheet.tags)
        if sheet_type == "character":
            doc["resources"] = fit_counters(doc.get("resources") or {}, sheet.resources)
    return prepare
