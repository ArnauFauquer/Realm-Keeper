"""Sheets: ```sheet blocks in notes, their parsing and the catalog built from
them. Run from backend/:  python -m pytest tests/test_sheets.py
"""
import json
import tempfile
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from routes.notes import get_markdown_service
from routes.sheets import router as sheets_router
from services.fences import extract_fenced_blocks, iter_fenced_blocks, strip_fenced_blocks
from services.markdown_parser import MarkdownParser
from services.markdown_service import MarkdownService
from services.sheet_parser import SheetParseError, parse_sheet_source, slugify

FIXTURES = Path(__file__).parent / "fixtures" / "sheets"


# ── shared cases (frontend/tests/sheet.test.js runs the same files) ────────

@pytest.mark.parametrize("case", sorted(p.stem for p in FIXTURES.glob("*.json")))
def test_sheet_matches_expected(case):
    sheet, warnings = parse_sheet_source((FIXTURES / f"{case}.yaml").read_text(encoding="utf-8"))
    expected = json.loads((FIXTURES / f"{case}.json").read_text(encoding="utf-8"))
    assert {"sheet": sheet.model_dump(), "warnings": warnings} == expected


@pytest.mark.parametrize("case", sorted(p.stem for p in FIXTURES.glob("error-*.yaml")))
def test_invalid_sheet_is_rejected(case):
    with pytest.raises(SheetParseError):
        parse_sheet_source((FIXTURES / f"{case}.yaml").read_text(encoding="utf-8"))


def test_an_alias_bomb_is_refused_before_it_can_expand():
    # 350 bytes that would be gigabytes as JSON: refused at the alias, not expanded.
    with pytest.raises(SheetParseError, match="aliases"):
        parse_sheet_source((FIXTURES / "error-alias-bomb.yaml").read_text(encoding="utf-8"))
    with pytest.raises(SheetParseError, match="aliases"):
        parse_sheet_source("name: A\nresources: &r {HP: 6}\nstats: *r\n")


def test_a_sheet_that_is_far_too_long_is_not_parsed():
    with pytest.raises(SheetParseError, match="longer"):
        parse_sheet_source("name: A\ntext: " + "x" * 200_000)


def test_anchors_that_nothing_refers_to_are_harmless():
    sheet, _ = parse_sheet_source("name: A\nsections:\n  - counters:\n      HP: &hp 6\n")
    assert sheet.resources["HP"].max == 6


def test_slugify_drops_accents_and_punctuation():
    assert slugify("Jabalí Gigante") == "jabali-gigante"
    assert slugify("  Aria's  Ghost!! ") == "aria-s-ghost"
    assert slugify("???") == ""


# ── fenced blocks ───────────────────────────────────────────────────────────

def test_extracts_only_blocks_of_the_requested_language():
    text = "intro\n```sheet\nname: A\n```\n\n```yaml\nname: B\n```\n\n~~~sheet\nname: C\n~~~\n"
    assert extract_fenced_blocks(text, "sheet") == ["name: A", "name: C"]


def test_a_longer_fence_is_closed_only_by_a_fence_as_long():
    text = "````sheet\nname: A\n```\nstill A\n````\nafter"
    assert extract_fenced_blocks(text, "sheet") == ["name: A\n```\nstill A"]


def test_language_is_the_first_word_of_the_info_string():
    blocks = list(iter_fenced_blocks("```Sheet title=x\nname: A\n```"))
    assert blocks[0].lang == "sheet"
    assert blocks[0].info == "Sheet title=x"


def test_an_unterminated_fence_runs_to_the_end():
    assert extract_fenced_blocks("```sheet\nname: A\nresources:", "sheet") == ["name: A\nresources:"]


def test_a_block_inside_a_callout_is_found_without_its_quote_markers():
    text = "> [!note] Imp\n> ```sheet\n> name: Imp\n> text: |\n>   one\n>\n>   two\n> ```\n> after\n\nout"
    assert extract_fenced_blocks(text, "sheet") == ["name: Imp\ntext: |\n  one\n\n  two"]


def test_nested_quotes_are_unquoted_level_by_level():
    text = "> > ```sheet\n> > name: A\n> > ```\n"
    assert extract_fenced_blocks(text, "sheet") == ["name: A"]


def test_a_quote_that_ends_before_the_closing_fence_ends_the_block():
    text = "> ```sheet\n> name: A\n\nplain text\n```\n"
    blocks = list(iter_fenced_blocks(text))
    assert blocks[0].content == "name: A"
    assert blocks[0].end == 1
    # the lone ``` after it opens a block of its own, with no language
    assert [b.lang for b in blocks] == ["sheet", ""]


def test_gt_signs_inside_an_unquoted_block_are_content():
    text = "```sheet\ntext: >\n  folded\n> not a quote\n```"
    assert extract_fenced_blocks(text, "sheet") == ["text: >\n  folded\n> not a quote"]


def test_strip_removes_fences_and_their_contents():
    assert strip_fenced_blocks("a\n```\n#tag\n```\nb") == "a\n\n\n\nb"


# ── tags and links ──────────────────────────────────────────────────────────

@pytest.fixture
def vault():
    with tempfile.TemporaryDirectory() as d:
        yield Path(d)


def _write(vault: Path, name: str, text: str) -> None:
    path = vault / f"{name}.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def test_a_sheet_in_a_callout_reaches_the_catalog(vault):
    _write(vault, "Imp", "> [!note] Imp\n> ```sheet\n> name: Imp\n> ```\n")
    service = MarkdownService(vault_path=str(vault), ignore_tag="draft")
    assert service.get_sheet("Imp#imp") is not None


def test_hash_signs_inside_fences_are_not_tags(vault):
    _write(vault, "note", "A real #tag.\n\n```sheet\nname: A\ncolor: #ff0000\n```\n\n```mermaid\nstyle A fill:#f9f\n```\n")
    _, _, tags, _ = MarkdownParser(vault_path=vault).parse_file(vault / "note.md")
    assert tags == ["tag"]


def test_wikilinks_inside_a_sheet_still_count_as_links(vault):
    _write(vault, "cave", "# Cave")
    _write(vault, "note", "```sheet\nname: A\ntext: \"Lives in [[cave]].\"\n```\n")
    parsed = MarkdownParser(vault_path=vault).parse(vault / "note.md")
    assert parsed.wikilinks == ["cave"]
    assert "[cave](/note/cave)" in parsed.content
    assert "[[cave]]" in parsed.raw_body


# ── catalog ─────────────────────────────────────────────────────────────────

def _sheet_vault(vault: Path) -> MarkdownService:
    _write(vault, "Bestiary/Bugboar", "# Bugboar\n```sheet\nname: Bugboar\nsections:\n  - counters: {HP: 6}\n```\n")
    _write(vault, "Party/Aria", "```sheet\nname: Aria\nid: aria\ntype: character\nsections:\n  - counters: {HP: 12}\n```\n")
    _write(vault, "Party/Aria Old", "```sheet\nname: Aria (old)\nid: aria\ntype: character\n```\n")
    _write(vault, "Secret", "---\ntags: [draft]\n---\n```sheet\nname: Hidden Thing\n```\n")
    _write(vault, "Broken", "```sheet\nsections: [{counters: {HP: 1}}]\n```\n")
    _write(vault, "Stray tag", "```sheet\nname: Mimic\n# a comment about #draft stuff\n```\n")
    _write(vault, "Plain", "# No sheets here\n")
    return MarkdownService(vault_path=str(vault), ignore_tag="draft")


def test_catalog_lists_visible_valid_sheets_with_their_refs(vault):
    refs = {entry.ref: entry for entry in _sheet_vault(vault).get_sheets()}
    assert set(refs) == {"Bestiary/Bugboar#bugboar", "aria", "Stray tag#mimic"}
    assert refs["Bestiary/Bugboar#bugboar"].note_title == "Bugboar"
    assert refs["aria"].note_id == "Party/Aria"
    assert refs["aria"].sheet.type == "character"


def test_a_duplicate_ref_keeps_the_first_note_and_warns(vault):
    aria = _sheet_vault(vault).get_sheet("aria")
    assert aria.note_id == "Party/Aria"
    assert any("Party/Aria Old" in warning for warning in aria.warnings)


def test_a_hidden_note_contributes_no_sheets(vault):
    service = _sheet_vault(vault)
    assert service.get_sheet("Secret#hidden-thing") is None
    assert all(entry.note_id != "Secret" for entry in service.get_sheets())


def test_a_tag_inside_a_sheet_does_not_hide_its_note(vault):
    assert _sheet_vault(vault).get_sheet("Stray tag#mimic") is not None


def test_the_catalog_follows_note_changes_once_the_cache_is_dropped(vault):
    service = _sheet_vault(vault)
    assert service.get_sheet("Plain#newbie") is None
    _write(vault, "Plain", "```sheet\nname: Newbie\n```\n")
    service.invalidate_cache()
    assert service.get_sheet("Plain#newbie") is not None


def test_a_filtered_listing_does_not_replace_the_catalog(vault):
    service = _sheet_vault(vault)
    service.get_all_notes(search="aria")
    assert len(service.get_sheets()) == 3


# ── API ─────────────────────────────────────────────────────────────────────

@pytest.fixture
def client(vault):
    service = _sheet_vault(vault)
    app = FastAPI()
    app.include_router(sheets_router)
    app.dependency_overrides[get_markdown_service] = lambda: service
    return TestClient(app)


def test_list_returns_summaries_without_the_body(client):
    body = client.get("/api/sheets").json()
    assert {s["ref"] for s in body} == {"Bestiary/Bugboar#bugboar", "aria", "Stray tag#mimic"}
    assert all("sections" not in s and "sheet" not in s for s in body)
    aria = next(s for s in body if s["ref"] == "aria")
    assert aria["resources"]["HP"]["max"] == 12


def test_list_filters_by_type_and_search(client):
    characters = client.get("/api/sheets", params={"type": "character"}).json()
    assert [s["ref"] for s in characters] == ["aria"]
    found = client.get("/api/sheets", params={"search": "BUG"}).json()
    assert [s["ref"] for s in found] == ["Bestiary/Bugboar#bugboar"]


def test_list_rejects_an_unknown_type(client):
    assert client.get("/api/sheets", params={"type": "monster"}).status_code == 400


def test_detail_looks_a_sheet_up_by_ref(client):
    response = client.get("/api/sheets/detail", params={"ref": "Bestiary/Bugboar#bugboar"})
    assert response.status_code == 200
    assert response.json()["sheet"]["resources"]["HP"]["max"] == 6
    assert client.get("/api/sheets/detail", params={"ref": "nobody"}).status_code == 404
