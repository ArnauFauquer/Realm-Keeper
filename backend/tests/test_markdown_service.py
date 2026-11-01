"""The vault as a service: which notes are hidden or refused, what the graph
and the folder map make of them, what a failed commit does, and how moved
documents are followed. Run from backend/:  python -m pytest tests/test_markdown_service.py
"""
import pytest

from services import markdown_service
from services.git_sync_utils import GitCommitError
from services.markdown_service import MarkdownService, NoteSaveError, content_sha


@pytest.fixture
def commits(monkeypatch):
    log = []
    monkeypatch.setattr(markdown_service, "commit_and_push", lambda repo, lock, paths, **kw: log.append((paths, kw["message"])))
    return log


def _service(tmp_path, notes=None, git=True, ignore="draft"):
    service = MarkdownService(vault_path=str(tmp_path / "vault"), ignore_tag=ignore, git=git)
    for note_id, text in (notes or {}).items():
        path = service.vault_path / f"{note_id}.md"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    return service


# ── which ids can name a note ───────────────────────────────────────────────

@pytest.mark.parametrize("bad", ["", "/", "..", "a/../b", ".git/config", ".hidden", "a//b", "a\\b", "a\x00b"])
def test_an_id_that_could_not_name_a_note_is_refused(bad):
    with pytest.raises(ValueError):
        MarkdownService.check_note_id(bad)


def test_an_id_is_normalised():
    assert MarkdownService.check_note_id("/People/Mirela/") == "People/Mirela"


def test_a_symlink_out_of_the_vault_is_denied(tmp_path):
    service = _service(tmp_path)
    outside = tmp_path / "outside.md"
    outside.write_text("secret")
    try:
        (service.vault_path / "link.md").symlink_to(outside)
    except OSError:
        pytest.skip("symlinks unavailable")
    with pytest.raises(ValueError, match="within vault"):
        service.get_raw_content("link")


def test_raw_content_is_verbatim_and_missing_is_none(tmp_path):
    service = _service(tmp_path, {"Tavern": "---\ntitle: T\n---\n[[Cave]]\n"})
    assert service.get_raw_content("Tavern") == "---\ntitle: T\n---\n[[Cave]]\n"
    assert service.get_raw_content("Nothing") is None


# ── hiding ──────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("tags,hidden", [
    (["draft"], True), (["Draft"], True), (["#draft"], True), (["draft/wip"], True),
    (["npc", "draft"], True), (["draft, npc"], True), (["drafty"], False), (["npc"], False), ([], False),
])
def test_what_counts_as_hidden(tmp_path, tags, hidden):
    assert _service(tmp_path).is_hidden(tags) is hidden


def test_without_an_ignore_tag_nothing_is_hidden(tmp_path):
    assert _service(tmp_path, ignore="").is_hidden(["draft"]) is False


def test_a_hidden_note_is_neither_listed_nor_readable_nor_linked(tmp_path):
    service = _service(tmp_path, {
        "Public": "See [[Secret]] and [[Other]]\n", "Other": "x\n", "Secret": "#draft\nhidden\n",
    })
    assert [n.id for n in service.get_all_notes()] == ["Other", "Public"]
    assert service.get_note("Secret") is None
    assert service.get_note("Public") is not None


# ── reading ─────────────────────────────────────────────────────────────────

def test_a_note_is_parsed_and_then_served_from_cache(tmp_path, monkeypatch):
    service = _service(tmp_path, {"People/Mirela": "---\ntitle: Captain Mirela\ntags: [npc]\n---\nHello\n"})
    note = service.get_note("People/Mirela")
    assert (note.id, note.title, note.path, note.tags) == ("People/Mirela", "Captain Mirela", "People/Mirela.md", ["npc"])
    monkeypatch.setattr(service.parser, "parse_file", lambda path: pytest.fail("parsed again"))
    assert service.get_note("People/Mirela") is note


def test_a_cached_note_that_is_too_old_is_read_again(tmp_path, monkeypatch):
    service = _service(tmp_path, {"A": "one\n"})
    assert service.get_note("A") is not None
    monkeypatch.setattr(service, "_is_cache_valid", lambda cached_at: False)
    (service.vault_path / "A.md").write_text("two\n")
    assert "two" in service.get_note("A").content


def test_a_note_that_cannot_be_parsed_is_not_found_instead_of_an_error(tmp_path, monkeypatch):
    service = _service(tmp_path, {"A": "x\n"})
    monkeypatch.setattr(service.parser, "parse_file", lambda path: (_ for _ in ()).throw(RuntimeError("bad")))
    assert service.get_note("A") is None


def test_a_note_that_cannot_be_listed_is_skipped(tmp_path, monkeypatch):
    service = _service(tmp_path, {"A": "x\n", "B": "y\n"})
    real = service.parser.parse

    def parse(path):
        if path.stem == "A":
            raise RuntimeError("bad yaml")
        return real(path)

    monkeypatch.setattr(service.parser, "parse", parse)
    assert [n.id for n in service.get_all_notes()] == ["B"]


def test_invalidating_forgets_one_note_or_everything(tmp_path):
    service = _service(tmp_path, {"A": "one\n", "B": "x\n"})
    service.get_note("A")
    (service.vault_path / "A.md").write_text("two\n")
    assert "one" in service.get_note("A").content
    service.invalidate_cache("A")
    assert "two" in service.get_note("A").content
    service.get_note("B")
    (service.vault_path / "B.md").write_text("changed\n")
    service.invalidate_cache()
    assert "changed" in service.get_note("B").content


def test_tags_are_sorted_ignoring_case_and_listed_once(tmp_path):
    service = _service(tmp_path, {"A": "#beta #Alpha\n", "B": "#beta\n"})
    assert service.get_all_tags() == ["Alpha", "beta"]


def test_the_fingerprint_changes_when_something_outside_the_app_writes(tmp_path):
    service = _service(tmp_path, {"A": "one\n"})
    before = service.fingerprint()
    assert service.fingerprint() == before
    (service.vault_path / "A.md").write_text("one, edited in Obsidian\n")
    assert service.fingerprint() != before
    (service.vault_path / "B.md").write_text("new\n")
    assert service.fingerprint() != before


def test_something_deleted_while_listed_does_not_break_the_fingerprint(tmp_path, monkeypatch):
    service = _service(tmp_path, {"A": "x\n"})
    ghost = service.vault_path / "ghost.md"
    real = service.parser.iter_note_files
    monkeypatch.setattr(service.parser, "iter_note_files", lambda: list(real()) + [ghost])
    assert service.fingerprint()


# ── the folder map and the graph ────────────────────────────────────────────

def test_a_folder_maps_to_its_own_note_its_namesake_or_nothing(tmp_path):
    service = _service(tmp_path, {
        "Factions": "the folder as a note\n", "Factions/Gulls": "x\n",
        "Places/Places": "namesake\n", "Places/Docks/Pier": "x\n", "Loose": "x\n",
    })
    assert service.get_container_folders() == {
        "Factions": "Factions", "Places": "Places/Places", "Places/Docks": None,
    }


def test_the_graph_resolves_links_by_id_title_and_case(tmp_path):
    service = _service(tmp_path, {
        "A": "[[B]] [[the cave]] [[People/Mirela]] [[Ghost]] [[B]]\n",
        "B": "---\ntitle: Bee\n---\n[[bee]]\n",
        "Cave": "---\ntitle: The Cave\n---\nx\n",
        "People/Mirela": "x\n",
    })
    graph = service.get_graph_data()
    assert {n["id"] for n in graph["nodes"]} == {"A", "B", "Cave", "People/Mirela"}
    links = {(l["source"], l["target"]) for l in graph["links"]}
    assert links == {("A", "B"), ("A", "Cave"), ("A", "People/Mirela"), ("B", "B")}
    assert len(graph["links"]) == len(links)   # a link written twice is drawn once


# ── saving, and git failing ─────────────────────────────────────────────────

def test_a_save_commits_what_it_wrote_under_the_authors_name(tmp_path, commits):
    service = _service(tmp_path)
    service.save_note("People/Mirela", "x", "GM", "gm@example.com")
    service.save_note("People/Mirela", "y", "GM", "gm@example.com")
    assert commits == [(["People/Mirela.md"], "Create note: People/Mirela"), (["People/Mirela.md"], "Update note: People/Mirela")]


def test_a_vault_that_is_a_plain_folder_commits_nothing(tmp_path, commits):
    service = _service(tmp_path, git=False)
    service.save_note("A", "x", "GM", "gm@example.com")
    assert commits == [] and service.get_raw_content("A") == "x"


def test_a_failed_commit_is_a_save_error_but_the_note_is_served_as_on_disk(tmp_path, monkeypatch):
    def push_fails(*args, **kwargs):
        raise GitCommitError("git push failed: https://TOKEN@host/r.git")

    monkeypatch.setattr(markdown_service, "commit_and_push", push_fails)
    service = _service(tmp_path, {"A": "old\n"})
    service.get_note("A")
    with pytest.raises(NoteSaveError) as exc:
        service.save_note("A", "new\n", "GM", "gm@example.com")
    assert "TOKEN" not in str(exc.value)
    assert "new" in service.get_note("A").content   # the cache did not outlive the write


def test_a_save_runs_under_the_vault_lock():
    service = MarkdownService(vault_path="/tmp/does-not-matter-rk", git=False)
    assert service.under_git_lock(lambda: 42) == 42


# ── following moved documents ───────────────────────────────────────────────

def test_notes_link_to_where_a_document_moved(tmp_path, commits):
    service = _service(tmp_path, {
        "Party": "`character:aria` and `Character:aria/` and ` character:aria ` and `character:bob` and `chart:aria`\n",
        "Other": "nothing here\n",
    })
    changed = service.follow_moved_documents("character", {"aria": "party/aria"}, "GM", "gm@example.com")
    assert changed == ["Party"]
    assert service.get_raw_content("Party") == "`character:party/aria` and `Character:party/aria` and ` character:party/aria ` and `character:bob` and `chart:aria`\n"
    assert commits == [(["Party.md"], "Follow moved character: aria -> party/aria")]


def test_several_moves_make_one_commit_and_nothing_to_follow_makes_none(tmp_path, commits):
    service = _service(tmp_path, {"Party": "`chart:a` `chart:b`\n"})
    assert service.follow_moved_documents("chart", {}, "GM", "gm@example.com") == []
    assert service.follow_moved_documents("chart", {"zzz": "y"}, "GM", "gm@example.com") == []
    assert service.follow_moved_documents("chart", {"a": "f/a", "b": "f/b"}, "GM", "gm@example.com") == ["Party"]
    assert commits == [(["Party.md"], "Follow 2 moved charts")]


def test_hash_of_the_content_is_stable_and_distinguishes():
    assert content_sha("a") == content_sha("a") != content_sha("b")
    assert len(content_sha("")) == 64
