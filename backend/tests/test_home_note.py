"""The note the app opens on: HOME_NOTE, else a usual name at the vault's top,
else its first note. Run from backend/:  python -m pytest tests/test_home_note.py
"""
from services.markdown_service import MarkdownService


def _vault(tmp_path, *names):
    vault = tmp_path / "vault"
    for name in names:
        path = vault / f"{name}.md"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(f"# {name}", encoding="utf-8")
    return MarkdownService(vault_path=str(vault), ignore_tag="draft", git=False)


def test_an_empty_vault_has_no_home(tmp_path):
    assert _vault(tmp_path).home_note() is None


def test_the_configured_note_if_the_vault_has_it(tmp_path):
    service = _vault(tmp_path, "index", "Lore/Start")
    assert service.home_note("Lore/Start") == "Lore/Start"
    assert service.home_note("Lore/Missing") == "index"


def test_a_usual_name_at_the_top_in_order(tmp_path):
    assert _vault(tmp_path, "Home", "index", "Zebra").home_note() == "index"
    assert _vault(tmp_path / "b", "README", "Aardvark").home_note() == "README"
    assert _vault(tmp_path / "c", "RealmKeeper", "index").home_note() == "RealmKeeper"


def test_otherwise_the_first_note_at_the_top_then_any(tmp_path):
    assert _vault(tmp_path, "Places/Port", "zeta", "Alpha").home_note() == "Alpha"
    assert _vault(tmp_path / "b", "Places/Port", "People/Mirela").home_note() == "People/Mirela"


def test_a_hidden_note_is_never_home(tmp_path):
    service = _vault(tmp_path, "notes")
    (tmp_path / "vault" / "index.md").write_text("---\ntags: [draft]\n---\n# Secret", encoding="utf-8")
    service.invalidate_cache()
    assert service.home_note() == "notes"
