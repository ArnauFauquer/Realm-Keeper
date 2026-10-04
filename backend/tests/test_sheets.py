"""Sheets: ```sheet blocks in notes, their parsing and the catalog built from
them. Run from backend/:  python -m pytest tests/test_sheets.py
"""
import json
import tempfile
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from routes.auth import require_auth
from routes.sheets import router as sheets_router
from services import doc_registry, sheet_catalog, sheet_import
from services.doc_backend import LocalDocBackend
from services.doc_collection import DocCollection
from services.fences import extract_fenced_blocks, iter_fenced_blocks, strip_fenced_blocks
from services import markdown_service
from services.markdown_parser import MarkdownParser
from services.sheet_parser import SheetParseError, parse_sheet_doc, parse_sheet_source, slugify
from services.sync_hub import DocHub

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


# ── a sheet kept as a document ──────────────────────────────────────────────

def test_a_documents_name_id_and_type_are_its_own():
    source = "name: Old name\nid: old\ntype: adversary\nsubtitle: Ranger\n"
    sheet, warnings = parse_sheet_doc({"id": "party/aria", "name": "Aria", "source": source}, "character")
    assert (sheet.id, sheet.name, sheet.type, sheet.subtitle) == ("party/aria", "Aria", "character", "Ranger")
    assert len(warnings) == 3 and all("ignored" in w for w in warnings)


def test_an_empty_document_is_an_empty_sheet():
    sheet, warnings = parse_sheet_doc({"id": "imp", "name": "Imp", "source": ""}, "adversary")
    assert (sheet.name, sheet.sections, warnings) == ("Imp", [], [])
    with pytest.raises(SheetParseError):
        parse_sheet_doc({"id": "imp", "name": "Imp", "source": "- a list"}, "adversary")


# ── catalog ─────────────────────────────────────────────────────────────────

@pytest.fixture
def store(tmp_path, monkeypatch):
    """Local character, adversary, encounter and map collections, in place of the app's."""
    backend = LocalDocBackend(tmp_path / "store")
    collections = {
        "character": DocCollection(doc_registry.CHARACTER, backend),
        "adversary": DocCollection(doc_registry.ADVERSARY, backend),
        "encounter": DocCollection(doc_registry.ENCOUNTER, backend),
        "battlemap": DocCollection(doc_registry.BATTLEMAP, backend),
    }
    monkeypatch.setattr(sheet_catalog, "COLLECTIONS", {k: collections[k] for k in ("character", "adversary")})
    monkeypatch.setattr(sheet_catalog, "hub", DocHub(collections))
    for name, kind in (("characters_collection", "character"), ("adversary_collection", "adversary"),
                       ("encounter_collection", "encounter"), ("battlemap_collection", "battlemap")):
        monkeypatch.setattr(sheet_import, name, collections[kind])
    return collections


@pytest.fixture
def client(store):
    store["adversary"].create("Bugboar", folder_path="Bestiary")
    store["adversary"].save("Bestiary/bugboar", {"name": "Bugboar", "source": "tags: [tier 1]\nsections:\n  - counters: {HP: 6}\n"})
    store["character"].create("Aria")
    store["character"].set_field("aria", "source", "sections:\n  - counters: {HP: 12}\n")
    app = FastAPI()
    app.include_router(sheets_router)
    app.dependency_overrides[require_auth] = lambda: {"email": "gm@example.com"}
    return TestClient(app)


def test_list_returns_summaries_without_the_body(client):
    body = client.get("/api/sheets").json()
    assert [(s["type"], s["ref"], s["folder"]) for s in body] == [
        ("character", "aria", ""), ("adversary", "Bestiary/bugboar", "Bestiary"),
    ]
    assert all("sections" not in s and "sheet" not in s for s in body)
    assert body[0]["resources"]["HP"]["max"] == 12


def test_list_filters_by_type_and_search(client):
    assert [s["ref"] for s in client.get("/api/sheets", params={"type": "character"}).json()] == ["aria"]
    assert [s["ref"] for s in client.get("/api/sheets", params={"search": "TIER"}).json()] == ["Bestiary/bugboar"]


def test_list_rejects_an_unknown_type(client):
    assert client.get("/api/sheets", params={"type": "monster"}).status_code == 400


def test_detail_looks_a_sheet_up_by_type_and_ref(client):
    response = client.get("/api/sheets/detail", params={"type": "adversary", "ref": "Bestiary/bugboar"})
    assert response.status_code == 200
    assert response.json()["sheet"]["resources"]["HP"]["max"] == 6
    assert client.get("/api/sheets/detail", params={"type": "character", "ref": "Bestiary/bugboar"}).status_code == 404


def test_a_stored_sheet_is_always_valid_and_its_card_reads_from_it(store):
    made = store["adversary"].create("Imp")
    assert made.source == ""
    with pytest.raises(ValueError, match="whole number"):
        store["adversary"].save("imp", {"name": "Imp", "source": "sections:\n  - counters: {HP: lots}\n"})
    saved = store["adversary"].save("imp", {"name": "Imp", "source": "subtitle: Tiny\ntags: [fiend]\n"})
    assert (saved.subtitle, saved.tags) == ("Tiny", ["fiend"])
    assert store["adversary"].list_all()[0].subtitle == "Tiny"


# ── the sheets that were written in notes ───────────────────────────────────

def _sheet_vault(vault: Path) -> None:
    _write(vault, "Bestiary/Bugboar",
           "# Bugboar\n```sheet\nname: Bugboar   # required\nsections:\n  - counters: {HP: 6}\n```\nAfter.\n")
    _write(vault, "Bestiary/More", "```sheet\nname: Bugboar\n```\n\n> [!note] Imp\n> ```sheet\n> name: Imp\n> ```\n")
    _write(vault, "Party/Aria", "```sheet\nname: Aria\nid: aria\ntype: character\nsections:\n  - counters: {HP: 12}\n```\n")
    _write(vault, "Party/Aria Old", "```sheet\nname: Aria (old)\nid: aria\ntype: character\n```\n")
    _write(vault, "Broken", "```sheet\nsections: [{counters: {HP: 1}}]\n```\n")
    _write(vault, "Guide", "````markdown\n```sheet\nname: Example\n```\n````\n")


def test_the_documents_each_block_becomes(vault):
    _sheet_vault(vault)
    found = [(s.note_id, s.sheet.type, s.doc_id) for s in sheet_import.find_note_sheets(vault)]
    assert found == [
        ("Bestiary/Bugboar", "adversary", "Bestiary/bugboar"),
        ("Bestiary/More", "adversary", "Bestiary/bugboar-2"),
        ("Bestiary/More", "adversary", "Bestiary/imp"),
        ("Party/Aria", "character", "aria"),
        ("Party/Aria Old", "character", "aria"),
    ]


def test_the_yaml_loses_what_is_now_the_documents():
    source = "name: >-\n  Long\n  name\nid: x\nsubtitle: S\ntype: character\nsections: []\n"
    assert sheet_import.strip_document_fields(source) == "subtitle: S\nsections: []\n"


def test_importing_keeps_saved_values_and_follows_adversary_refs(vault, store):
    _sheet_vault(vault)
    store["character"].write_raw("aria", {"id": "aria", "name": "Aria", "rev": 4, "resources": {"HP": {"current": 5, "max": 12}}})
    store["encounter"].create("Fight")
    store["encounter"].write_raw("fight", {**store["encounter"].read_raw("fight"), "combatants": [
        {"id": "c1", "name": "Bugboar 1", "sheet": "Bestiary/More#bugboar", "resources": {}},
        {"id": "c2", "name": "Aria", "type": "character", "sheet": "aria"},
    ]})
    sheet_import.import_note_sheets(vault)

    aria = store["character"].read_raw("aria")
    assert (aria["name"], aria["rev"], aria["resources"]["HP"]["current"]) == ("Aria", 4, 5)
    assert aria["source"] == "sections:\n  - counters: {HP: 12}\n"
    assert sorted(m.id for m in store["adversary"].list_all()) == ["Bestiary/bugboar", "Bestiary/bugboar-2", "Bestiary/imp"]
    assert store["adversary"].read_raw("Bestiary/bugboar")["source"] == "sections:\n  - counters: {HP: 6}\n"
    assert [c["sheet"] for c in store["encounter"].read_raw("fight")["combatants"]] == ["Bestiary/bugboar-2", "aria"]

    store["adversary"].delete("Bestiary/imp")
    sheet_import.import_note_sheets(vault)                  # once: what was deleted since stays deleted
    assert store["adversary"].read_raw("Bestiary/imp") is None


def test_the_notes_get_the_links_in_place_of_their_blocks(vault):
    _sheet_vault(vault)
    changed = sheet_import.rewrite_notes(vault)
    assert len(changed) == 4
    assert (vault / "Bestiary/Bugboar.md").read_text(encoding="utf-8") == "# Bugboar\n`adversary:Bestiary/bugboar`\nAfter.\n"
    assert (vault / "Bestiary/More.md").read_text(encoding="utf-8") == (
        "`adversary:Bestiary/bugboar-2`\n\n> [!note] Imp\n> `adversary:Bestiary/imp`\n"
    )
    assert (vault / "Party/Aria Old.md").read_text(encoding="utf-8") == "`character:aria`\n"
    assert "```sheet" in (vault / "Guide.md").read_text(encoding="utf-8")


# ── notes follow a moved document ───────────────────────────────────────────

def test_the_notes_follow_a_moved_document_in_one_commit(vault, monkeypatch):
    commits = []
    monkeypatch.setattr(markdown_service, "commit_and_push", lambda repo, lock, paths, **kw: commits.append((sorted(paths), kw["message"])))
    _write(vault, "Party/Aria", "Aria: `character:aria` and ` character:aria/ `.\nNot her: `character:arianne`, `adversary:aria`.\n")
    _write(vault, "Fight", "> `Character:aria`\n")
    _write(vault, "Other", "`character:bram`\n")
    service = markdown_service.MarkdownService(vault_path=str(vault))

    changed = service.follow_moved_documents("character", {"aria": "party/aria"}, "GM", "gm@example.com")

    assert sorted(changed) == ["Fight", "Party/Aria"]
    assert (vault / "Party/Aria.md").read_text(encoding="utf-8") == (
        "Aria: `character:party/aria` and ` character:party/aria `.\nNot her: `character:arianne`, `adversary:aria`.\n"
    )
    assert (vault / "Fight.md").read_text(encoding="utf-8") == "> `Character:party/aria`\n"
    assert commits == [(["Fight.md", str(Path("Party/Aria.md"))], "Follow moved character: aria -> party/aria")]
    assert service.follow_moved_documents("character", {"nobody": "x"}, "GM", "gm@example.com") == []
    assert len(commits) == 1   # nothing to commit
