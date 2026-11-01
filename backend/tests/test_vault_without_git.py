"""A vault that is a plain folder (GIT_ENABLED=false): saves only write the
file, and edits made outside the app (Obsidian on the same volume) are
noticed. Run from backend/:  python -m pytest tests/test_vault_without_git.py
"""
from services import markdown_service
from services.markdown_service import MarkdownService, content_sha


def test_without_git_a_save_is_only_written_to_disk(tmp_path, monkeypatch):
    def no_git(*args, **kwargs):
        raise AssertionError("git was run")
    monkeypatch.setattr(markdown_service, "commit_and_push", no_git)
    service = MarkdownService(vault_path=str(tmp_path / "vault"), git=False)
    assert service.save_note("Lore/Tavern", "# Tavern", "GM", "gm@example.com") == (True, content_sha("# Tavern"))
    assert (tmp_path / "vault" / "Lore" / "Tavern.md").read_text(encoding="utf-8") == "# Tavern"
    service.save_note("Lore/Map", "See `chart:old`", "GM", "gm@example.com")
    assert service.follow_moved_documents("chart", {"old": "new"}, "GM", "gm@example.com") == ["Lore/Map"]
    assert service.get_raw_content("Lore/Map") == "See `chart:new`"


def test_the_fingerprint_notices_changes_made_outside_the_app(tmp_path):
    """The vault watch (main._watch_vault) drops the caches when this changes."""
    vault = tmp_path / "vault"
    service = MarkdownService(vault_path=str(vault), git=False)
    (vault / "a.md").write_text("one", encoding="utf-8")
    before = service.fingerprint()
    assert service.fingerprint() == before
    (vault / ".obsidian").mkdir()
    (vault / ".obsidian" / "workspace.md").write_text("not a note", encoding="utf-8")
    assert service.fingerprint() == before
    (vault / "a.md").write_text("one, edited", encoding="utf-8")
    edited = service.fingerprint()
    assert edited != before
    (vault / "b.md").write_text("new", encoding="utf-8")
    assert service.fingerprint() != edited


def test_a_note_edited_on_disk_shows_once_the_caches_are_dropped(tmp_path):
    vault = tmp_path / "vault"
    service = MarkdownService(vault_path=str(vault), git=False)
    (vault / "a.md").write_text("First", encoding="utf-8")
    assert "First" in service.get_note("a").content
    (vault / "a.md").write_text("Second", encoding="utf-8")
    service.invalidate_cache()
    assert "Second" in service.get_note("a").content
