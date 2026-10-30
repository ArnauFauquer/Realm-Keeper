"""The app's own wiring: cloning and pulling the vault, noticing it change on
disk, the periodic pull, and refusing to start with an empty vault. Git itself
is scripted. Run from backend/:  python -m pytest tests/test_main_sync.py
"""
import asyncio
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest

import main
from services.git_sync_utils import GitCommitError


def _done(code=0, out="", err=""):
    return SimpleNamespace(returncode=code, stdout=out, stderr=err)


@pytest.fixture
def vault(tmp_path, monkeypatch):
    path = tmp_path / "vault"
    path.mkdir()
    monkeypatch.setattr(main.settings, "VAULT_PATH", path)
    monkeypatch.setattr(main.settings, "GIT_ENABLED", True)
    monkeypatch.setattr(main.settings, "REPO_URL", "https://TOKEN@github.com/o/vault.git")
    monkeypatch.setattr(main, "_mark_vault_safe", lambda p: None)
    return path


@pytest.fixture
def log(monkeypatch):
    lines = []
    monkeypatch.setattr(main.logger, "info", lambda m, *a, **k: lines.append(("info", m)))
    monkeypatch.setattr(main.logger, "error", lambda m, *a, **k: lines.append(("error", m)))
    return lines


def _errors(log):
    return [m for level, m in log if level == "error"]


# ── marking the vault safe ──────────────────────────────────────────────────

def test_the_vault_is_marked_safe_once(monkeypatch):
    calls = []

    def run(cmd, **kw):
        calls.append(cmd)
        return _done(out="/other\n/vault\n" if len(calls) == 1 else "")

    monkeypatch.setattr(main.subprocess, "run", run)
    main._mark_vault_safe(Path("/vault"))
    assert len(calls) == 1   # already listed: not added again
    calls.clear()
    main._mark_vault_safe(Path("/new"))
    assert len(calls) == 2 and calls[1][-2:] == ["safe.directory", "/new"]


# ── sync_vault ──────────────────────────────────────────────────────────────

def test_a_vault_without_git_is_left_alone(vault, monkeypatch):
    monkeypatch.setattr(main.settings, "GIT_ENABLED", False)
    monkeypatch.setattr(main, "pull_rebase", lambda p: pytest.fail("no git, no pull"))
    main.sync_vault()


def test_a_clone_is_pulled_with_the_current_remote(vault, monkeypatch, log):
    (vault / ".git").mkdir()
    git = []
    monkeypatch.setattr(main, "run_git", lambda repo, *args, **kw: git.append(args) or _done())
    monkeypatch.setattr(main, "pull_rebase", lambda p: _done(out="Already up to date. https://TOKEN@github.com/x"))
    main.sync_vault()
    assert git == [("remote", "set-url", "origin", "https://TOKEN@github.com/o/vault.git")]
    assert any("Vault sync successful" in m and "TOKEN" not in m for _, m in log)


def test_a_pull_that_fails_is_logged_without_the_token(vault, monkeypatch, log):
    (vault / ".git").mkdir()
    monkeypatch.setattr(main, "run_git", lambda *a, **k: _done())
    monkeypatch.setattr(main, "pull_rebase", lambda p: _done(1, err="fatal: https://TOKEN@github.com/x denied"))
    main.sync_vault()
    [error] = _errors(log)
    assert "exit 1" in error and "TOKEN" not in error


def test_a_clone_without_a_remote_url_says_it_has_nothing_to_pull(vault, monkeypatch, log):
    (vault / ".git").mkdir()
    monkeypatch.setattr(main.settings, "REPO_URL", "")
    git = []
    monkeypatch.setattr(main, "run_git", lambda *a, **k: git.append(a))
    monkeypatch.setattr(main, "pull_rebase", lambda p: _done())
    main.sync_vault()
    assert git == []   # the remote is not rewritten with nothing


def test_git_enabled_with_no_clone_and_no_url_is_an_error_not_a_crash(vault, monkeypatch, log):
    monkeypatch.setattr(main.settings, "REPO_URL", "")
    main.sync_vault()
    assert any("not a git clone" in m for m in _errors(log))


def _fake_clone(monkeypatch, code=0, err=""):
    def run(cmd, **kw):
        target = Path(cmd[-1])
        if code == 0:
            (target / "Notes").mkdir(parents=True)
            (target / "Notes" / "Tavern.md").write_text("# Tavern")
            (target / "index.md").write_text("# Hi")
        else:
            target.mkdir(parents=True, exist_ok=True)
        return _done(code, err=err)

    monkeypatch.setattr(main.subprocess, "run", run)


def test_a_first_clone_replaces_whatever_was_in_the_vault(vault, monkeypatch, log, tmp_path):
    monkeypatch.setattr(main, "Path", lambda p: tmp_path / "clone-tmp" if p == "/tmp/_vault_clone_tmp" else Path(p))
    (vault / "stale.md").write_text("old")
    (vault / "olddir").mkdir()
    (vault / "olddir" / "x.md").write_text("old")
    _fake_clone(monkeypatch)
    main.sync_vault()
    assert sorted(p.name for p in vault.iterdir()) == ["Notes", "index.md"]
    assert (vault / "Notes" / "Tavern.md").read_text() == "# Tavern"
    assert not (tmp_path / "clone-tmp").exists()
    assert _errors(log) == []


def test_a_clone_that_fails_keeps_the_vault_and_hides_the_token(vault, monkeypatch, log, tmp_path):
    monkeypatch.setattr(main, "Path", lambda p: tmp_path / "clone-tmp" if p == "/tmp/_vault_clone_tmp" else Path(p))
    (vault / "kept.md").write_text("mine")
    _fake_clone(monkeypatch, code=128, err="fatal: could not read from https://TOKEN@github.com/o/vault.git")
    main.sync_vault()
    assert (vault / "kept.md").exists()
    assert not (tmp_path / "clone-tmp").exists()
    [error] = _errors(log)
    assert "128" in error and "TOKEN" not in error


def test_a_leftover_temporary_clone_is_cleared_first(vault, monkeypatch, tmp_path):
    leftover = tmp_path / "clone-tmp"
    leftover.mkdir()
    (leftover / "junk").write_text("x")
    monkeypatch.setattr(main, "Path", lambda p: leftover if p == "/tmp/_vault_clone_tmp" else Path(p))
    seen = {}

    def run(cmd, **kw):
        seen["junk_still_there"] = (leftover / "junk").exists()
        return _done(128, err="no")

    monkeypatch.setattr(main.subprocess, "run", run)
    main.sync_vault()
    assert seen == {"junk_still_there": False}


@pytest.mark.parametrize("raised", [subprocess.TimeoutExpired("git", 300), GitCommitError("git pull timed out")])
def test_a_sync_that_times_out_is_logged(vault, monkeypatch, log, raised):
    (vault / ".git").mkdir()
    monkeypatch.setattr(main, "run_git", lambda *a, **k: (_ for _ in ()).throw(raised))
    main.sync_vault()
    assert any("timed out" in m for m in _errors(log))


def test_any_other_sync_error_is_logged_not_raised(vault, monkeypatch, log):
    (vault / ".git").mkdir()
    monkeypatch.setattr(main, "run_git", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom https://TOKEN@h/r")))
    main.sync_vault()
    [error] = _errors(log)
    assert "boom" in error and "TOKEN" not in error


# ── watching the vault ──────────────────────────────────────────────────────

def test_the_watch_is_off_when_the_interval_is_zero(monkeypatch, log):
    monkeypatch.setattr(main.settings, "VAULT_WATCH_INTERVAL", 0)
    asyncio.run(main._watch_vault())
    assert any("disabled" in m for _, m in log)


def test_a_change_on_disk_drops_the_caches_and_tells_the_open_pages(monkeypatch):
    monkeypatch.setattr(main.settings, "VAULT_WATCH_INTERVAL", 0.01)
    prints = iter(["same", "same", "changed", "changed", "changed"])
    monkeypatch.setattr(main.md_service_instance, "fingerprint", lambda: next(prints, "changed"))
    invalidated, announced = [], []
    monkeypatch.setattr(main.md_service_instance, "invalidate_cache", lambda *a: invalidated.append(1))

    async def announce(message):
        announced.append(message)

    monkeypatch.setattr(main.doc_hub, "announce", announce)

    async def run():
        task = asyncio.create_task(main._watch_vault())
        for _ in range(100):
            await asyncio.sleep(0.01)
            if announced:
                break
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(run())
    assert announced == [{"type": "notes"}]   # once: the next ticks saw no change
    assert invalidated == [1]


def test_a_fingerprint_that_fails_is_skipped_and_the_watch_goes_on(monkeypatch, log):
    monkeypatch.setattr(main.settings, "VAULT_WATCH_INTERVAL", 0.01)
    calls = {"n": 0}

    def fingerprint():
        calls["n"] += 1
        if calls["n"] == 2:
            raise OSError("share unmounted")
        return "same"

    monkeypatch.setattr(main.md_service_instance, "fingerprint", fingerprint)

    async def run():
        task = asyncio.create_task(main._watch_vault())
        for _ in range(100):
            await asyncio.sleep(0.01)
            if calls["n"] >= 4:
                break
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(run())
    assert calls["n"] >= 4
    assert any("Vault watch error" in m for m in _errors(log))


# ── the periodic pull ───────────────────────────────────────────────────────

def test_no_periodic_pull_without_git_or_with_a_zero_interval(monkeypatch, log):
    monkeypatch.setattr(main.settings, "GIT_ENABLED", False)
    asyncio.run(main._periodic_sync())
    monkeypatch.setattr(main.settings, "GIT_ENABLED", True)
    monkeypatch.setattr(main.settings, "GIT_SYNC_INTERVAL", 0)
    asyncio.run(main._periodic_sync())
    assert any("disabled" in m for _, m in log)


def test_the_periodic_pull_runs_under_the_vault_lock_then_drops_the_caches(monkeypatch):
    monkeypatch.setattr(main.settings, "GIT_ENABLED", True)
    monkeypatch.setattr(main.settings, "GIT_SYNC_INTERVAL", 0.01)
    order = []
    monkeypatch.setattr(main.md_service_instance, "under_git_lock", lambda fn: order.append(("locked", fn)))
    monkeypatch.setattr(main.md_service_instance, "invalidate_cache", lambda *a: order.append("invalidated"))

    async def run():
        task = asyncio.create_task(main._periodic_sync())
        for _ in range(100):
            await asyncio.sleep(0.01)
            if "invalidated" in order:
                break
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(run())
    assert order[0] == ("locked", main.sync_vault) and order[1] == "invalidated"


# ── starting up ─────────────────────────────────────────────────────────────

def test_the_app_refuses_to_start_when_the_first_clone_failed(vault, monkeypatch):
    """In k8s the vault is an emptyDir: serving an empty one would turn the pod
    ready; crashing makes the kubelet retry and a rolling update keep the old pod."""
    monkeypatch.setattr(main, "sync_vault", lambda: None)
    monkeypatch.setattr(main, "clear_stale_index_lock", lambda p: None)

    async def start():
        async with main.lifespan(main.app):
            pass

    with pytest.raises(RuntimeError, match="empty vault"):
        asyncio.run(start())


def test_the_app_clears_a_lock_a_killed_git_left_before_serving(vault, monkeypatch):
    (vault / ".git").mkdir()
    cleared = []
    monkeypatch.setattr(main, "clear_stale_index_lock", cleared.append)
    monkeypatch.setattr(main, "sync_vault", lambda: None)
    monkeypatch.setattr(main.settings, "GIT_SYNC_INTERVAL", 0)
    monkeypatch.setattr(main.settings, "VAULT_WATCH_INTERVAL", 0)

    async def start():
        async with main.lifespan(main.app):
            pass

    asyncio.run(start())
    assert cleared == [vault]
