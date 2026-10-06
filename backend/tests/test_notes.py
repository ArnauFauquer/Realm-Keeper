"""Saving notes: conflicts, saves that change nothing, search, and git that
recovers. Run from backend/:  python -m pytest tests/test_notes.py
"""
import shutil
import subprocess
import threading
from pathlib import Path

import pytest

from services import git_sync_utils, markdown_service
from services.markdown_service import MarkdownService, NoteConflict, content_sha


@pytest.fixture
def service(tmp_path, monkeypatch):
    commits = []
    monkeypatch.setattr(markdown_service, "commit_and_push", lambda repo, lock, paths, **kw: commits.append(kw["message"]))
    service = MarkdownService(vault_path=str(tmp_path / "vault"))
    service.commits = commits
    return service


def _save(service, note_id, content, base_sha=None):
    return service.save_note(note_id, content, "GM", "gm@example.com", base_sha=base_sha)


def test_a_save_over_a_note_someone_else_changed_is_a_conflict(service):
    assert _save(service, "Tavern", "one") == (True, content_sha("one"))
    loaded = content_sha(service.get_raw_content("Tavern"))
    _save(service, "Tavern", "two (someone else)")
    with pytest.raises(NoteConflict):
        _save(service, "Tavern", "mine", base_sha=loaded)
    assert service.get_raw_content("Tavern") == "two (someone else)"   # nothing written
    # Saving on top of what is there now works; without a base, nothing is checked.
    assert _save(service, "Tavern", "mine", base_sha=content_sha("two (someone else)"))[0] is False
    _save(service, "Tavern", "anyway")


def test_creating_a_note_that_exists_is_a_conflict(service):
    _save(service, "Tavern", "theirs")
    with pytest.raises(NoteConflict):
        _save(service, "Tavern", "mine", base_sha="")
    assert _save(service, "New", "mine", base_sha="") == (True, content_sha("mine"))


def test_saving_what_is_already_there_is_not_an_error(service):
    _save(service, "Tavern", "same")
    assert service.commits == ["Create note: Tavern"]
    assert _save(service, "Tavern", "same") == (False, content_sha("same"))
    assert service.commits == ["Create note: Tavern"]   # no commit, no "No changes to save" 502


def test_searching_filters_the_listing_without_parsing_the_vault_again(service, monkeypatch):
    for name, text in (("Tavern", "#inn"), ("Cave", "#dungeon"), ("Old tavern", "#inn #ruin")):
        _save(service, name, f"{text}\n")
    assert [n.id for n in service.get_all_notes()] == ["Cave", "Old tavern", "Tavern"]
    monkeypatch.setattr(service.parser, "parse", lambda path: pytest.fail("parsed again"))
    assert [n.id for n in service.get_all_notes(search="TAVERN")] == ["Old tavern", "Tavern"]
    assert [n.id for n in service.get_all_notes(tags="ruin, dungeon")] == ["Cave", "Old tavern"]


def test_a_save_waits_for_links_being_followed_and_is_not_overwritten(service):
    _save(service, "Party", "`character:aria`\n")
    following = threading.Event()
    real_iter = service.parser.iter_note_files

    def slow_iter():
        files = list(real_iter())
        following.set()
        threading.Event().wait(0.2)   # the follow has read the note; a save lands now
        return iter(files)

    service.parser.iter_note_files = slow_iter
    follower = threading.Thread(
        target=service.follow_moved_documents, args=("character", {"aria": "party/aria"}, "GM", "gm@example.com"),
    )
    follower.start()
    following.wait()
    _save(service, "Party", "`character:aria`\nA line the GM just wrote.\n")
    follower.join()
    # The save waited for the follow, so it wasn't lost to the follow's rewrite.
    assert service.get_raw_content("Party") == "`character:aria`\nA line the GM just wrote.\n"


@pytest.mark.skipif(shutil.which("git") is None, reason="needs git")
def test_a_pull_that_conflicts_is_aborted_not_left_mid_rebase(tmp_path):
    def git(repo, *args):
        return subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True, check=True)

    origin = tmp_path / "origin.git"
    subprocess.run(["git", "init", "--bare", "-b", "main", str(origin)], check=True, capture_output=True)
    clones = []
    for name in ("app", "obsidian"):
        clone = tmp_path / name
        subprocess.run(["git", "clone", str(origin), str(clone)], check=True, capture_output=True)
        git(clone, "config", "user.email", f"{name}@example.com")
        git(clone, "config", "user.name", name)
        clones.append(clone)
    app, obsidian = clones
    (obsidian / "Note.md").write_text("start\n")
    git(obsidian, "add", "-A")
    git(obsidian, "commit", "-m", "start")
    git(obsidian, "push", "origin", "HEAD:main")
    git(app, "pull", "origin", "main")
    git(app, "branch", "--set-upstream-to=origin/main")
    # The same line edited on both sides.
    (obsidian / "Note.md").write_text("theirs\n")
    git(obsidian, "commit", "-am", "theirs")
    git(obsidian, "push", "origin", "HEAD:main")
    (app / "Note.md").write_text("ours\n")
    git(app, "commit", "-am", "ours")

    result = git_sync_utils.pull_rebase(app)

    assert result.returncode != 0
    assert not (app / ".git" / "rebase-merge").exists() and not (app / ".git" / "rebase-apply").exists()
    assert (app / "Note.md").read_text() == "ours\n"   # no conflict markers served


def test_a_git_that_times_out_leaves_no_lock_behind(tmp_path, monkeypatch):
    (tmp_path / ".git").mkdir()
    (tmp_path / ".git" / "index.lock").write_text("")

    def too_slow(*args, **kwargs):
        raise subprocess.TimeoutExpired(args[0], kwargs.get("timeout"))

    monkeypatch.setattr(git_sync_utils.subprocess, "run", too_slow)
    with pytest.raises(git_sync_utils.GitCommitError, match="timed out"):
        git_sync_utils.run_git(Path(tmp_path), "push")
    assert not (tmp_path / ".git" / "index.lock").exists()
