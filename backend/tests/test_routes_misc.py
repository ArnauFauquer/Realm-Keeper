"""The small things the routes share: the error mapping, the sync socket, what
follows a moved document, and git's failure paths. Run from backend/:
    python -m pytest tests/test_routes_misc.py
"""
import asyncio
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest
from botocore.exceptions import BotoCoreError, ClientError
from fastapi import HTTPException
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from main import app
from routes import doc_follow
from routes.errors import blocking, guarded, storage_unavailable
from services import git_sync_utils
from services.auth_service import SESSION_COOKIE_NAME, create_session_token
from services.doc_collection import DocConflict, DocNotFound
from services.doc_registry import hub


# ── guarded ─────────────────────────────────────────────────────────────────

def _run(handler):
    return asyncio.run(guarded(handler)())


@pytest.mark.parametrize("raised,status", [
    (DocNotFound("no such chart"), 404),
    (DocConflict("moved meanwhile"), 409),
    (PermissionError("x"), 403),
    (ValueError("bad name"), 400),
    (ClientError({"Error": {"Code": "500", "Message": "m"}}, "Put"), 502),
    (BotoCoreError(), 502),
])
def test_guarded_turns_what_a_handler_raises_into_the_error_it_means(raised, status):
    async def handler():
        raise raised

    with pytest.raises(HTTPException) as exc:
        _run(handler)
    assert exc.value.status_code == status


def test_guarded_says_why_except_for_permissions_and_storage():
    async def not_found():
        raise DocNotFound("no such chart")

    async def forbidden():
        raise PermissionError("internal detail")

    async def storage():
        raise BotoCoreError()

    with pytest.raises(HTTPException) as caught:
        _run(not_found)
    assert caught.value.detail == "no such chart"
    with pytest.raises(HTTPException) as caught:
        _run(forbidden)
    assert caught.value.detail == "Not allowed"
    with pytest.raises(HTTPException) as caught:
        _run(storage)
    assert caught.value.detail == "Could not reach object storage"


def test_guarded_passes_through_what_a_handler_returns_and_other_errors():
    async def fine(a, b=2):
        return a + b

    assert asyncio.run(guarded(fine)(1, b=3)) == 4
    assert guarded(fine).__name__ == "fine"

    async def broken():
        raise RuntimeError("a real bug stays a 500")

    with pytest.raises(RuntimeError):
        _run(broken)


def test_blocking_work_runs_off_the_event_loop():
    import threading

    assert asyncio.run(blocking(lambda a, b: (a + b, threading.current_thread().name), 1, 2))[0] == 3
    main = threading.current_thread().name
    assert asyncio.run(blocking(lambda: threading.current_thread().name)) != main


def test_storage_unavailable_does_not_leak_the_error():
    class Log:
        def error(self, message):
            self.message = message

    log = Log()
    error = storage_unavailable(log, RuntimeError("secret bucket name"))
    assert error.status_code == 502 and "secret" not in error.detail
    assert "secret bucket name" in log.message


# ── the sync socket ─────────────────────────────────────────────────────────

@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def test_the_sync_socket_refuses_a_visitor(client):
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect("/ws/sync") as ws:
            ws.receive_text()
    assert exc.value.code == 1008


def test_the_sync_socket_takes_a_signed_in_user_and_forgets_it_on_leaving(client):
    client.cookies.set(SESSION_COOKIE_NAME, create_session_token("gm@example.com"))
    before = len(hub.sockets._sockets) if hasattr(hub.sockets, "_sockets") else None
    with client.websocket_connect("/ws/sync") as ws:
        ws.send_text("ignored: nothing is expected from a client")
    if before is not None:
        assert len(hub.sockets._sockets) == before


def test_the_sync_socket_asks_to_try_again_when_full(client, monkeypatch):
    client.cookies.set(SESSION_COOKIE_NAME, create_session_token("gm@example.com"))
    monkeypatch.setattr(hub, "connect", lambda websocket: False)
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect("/ws/sync") as ws:
            ws.receive_text()
    assert exc.value.code == 1013


# ── what follows a moved document ───────────────────────────────────────────

USER = {"email": "gm@example.com", "name": "GM"}


def test_every_kind_of_document_has_something_following_it():
    assert set(doc_follow.ON_MOVED) == {"chart", "vista", "character", "adversary", "encounter"}


def test_notes_are_rewritten_to_the_moved_documents_then_the_other_hooks_run(monkeypatch):
    seen = []
    monkeypatch.setattr(
        doc_follow.md_service_instance, "follow_moved_documents",
        lambda kind, moves, name, email: seen.append(("notes", kind, moves, name, email)) or ["Party"],
    )

    async def hook(moves, user):
        seen.append(("hook", moves, user["email"]))

    asyncio.run(doc_follow.following("chart", hook)({"a": "f/a"}, USER))
    assert seen == [("notes", "chart", {"a": "f/a"}, "GM", "gm@example.com"), ("hook", {"a": "f/a"}, "gm@example.com")]


def test_a_user_without_a_name_is_credited_by_email(monkeypatch):
    seen = []
    monkeypatch.setattr(
        doc_follow.md_service_instance, "follow_moved_documents",
        lambda kind, moves, name, email: seen.append(name) or [],
    )
    asyncio.run(doc_follow.following("chart")({"a": "b"}, {"email": "gm@example.com"}))
    assert seen == ["gm@example.com"]


def test_one_step_failing_does_not_keep_the_next_from_running(monkeypatch):
    def broken(*args):
        raise RuntimeError("git unreachable")

    monkeypatch.setattr(doc_follow.md_service_instance, "follow_moved_documents", broken)
    ran = []

    async def failing(moves, user):
        raise RuntimeError("hook failed")

    async def after(moves, user):
        ran.append(True)

    asyncio.run(doc_follow.following("chart", failing, after)({"a": "b"}, USER))
    assert ran == [True]


def test_an_encounter_changes_no_notes(monkeypatch):
    monkeypatch.setattr(
        doc_follow.md_service_instance, "follow_moved_documents",
        lambda *a: pytest.fail("a note cannot show an encounter"),
    )
    ran = []

    async def hook(moves, user):
        ran.append(moves)

    asyncio.run(doc_follow.following("encounter", hook, in_notes=False)({"e": "f/e"}, USER))
    assert ran == [{"e": "f/e"}]


# ── git ─────────────────────────────────────────────────────────────────────

def _result(code=0, out="", err=""):
    return SimpleNamespace(returncode=code, stdout=out, stderr=err)


@pytest.fixture
def git(monkeypatch):
    """Scripted git: each call is answered by `script[subcommand]`, and recorded."""
    calls, script = [], {}

    def run_git(repo, *args, timeout=30):
        sub = next(a for a in args if a in ("pull", "add", "commit", "push", "rebase"))
        calls.append(sub)
        answer = script.get(sub, _result())
        return answer.pop(0) if isinstance(answer, list) else answer

    monkeypatch.setattr(git_sync_utils, "run_git", run_git)
    return SimpleNamespace(calls=calls, script=script)


def _commit():
    import threading

    git_sync_utils.commit_and_push(Path("."), threading.Lock(), ["a.md"], "msg", "GM", "gm@example.com")


def test_a_commit_pulls_adds_commits_and_pushes(git):
    _commit()
    assert git.calls == ["pull", "add", "commit", "push"]


def test_a_failed_add_is_reported(git):
    git.script["add"] = _result(1, err="fatal: bad path")
    with pytest.raises(git_sync_utils.GitCommitError, match="git add failed: fatal: bad path"):
        _commit()


def test_nothing_to_commit_says_so_and_other_commit_failures_say_why(git):
    git.script["commit"] = _result(1, out="nothing to commit, working tree clean")
    with pytest.raises(git_sync_utils.GitCommitError, match="No changes to save"):
        _commit()
    git.script["commit"] = _result(1, err="author unknown")
    with pytest.raises(git_sync_utils.GitCommitError, match="git commit failed: author unknown"):
        _commit()


def test_a_rejected_push_pulls_and_tries_once_more(git):
    git.script["push"] = [_result(1, err="rejected"), _result(0)]
    _commit()
    assert git.calls == ["pull", "add", "commit", "push", "pull", "push"]


def test_a_push_that_fails_twice_is_an_error_without_the_token(git):
    git.script["push"] = [_result(1, err="x"), _result(1, err="denied https://TOKEN@github.com/o/r.git")]
    with pytest.raises(git_sync_utils.GitCommitError) as exc:
        _commit()
    assert "TOKEN" not in str(exc.value) and "***@github.com" in str(exc.value)


def test_credentials_are_redacted_from_any_text():
    assert git_sync_utils.redact_credentials("fatal: https://user:pw@host/repo") == "fatal: https://***@host/repo"
    assert git_sync_utils.redact_credentials("no url here") == "no url here"


def test_a_pull_that_works_is_not_aborted_and_one_that_fails_is(git):
    assert git_sync_utils.pull_rebase(Path(".")).returncode == 0
    assert git.calls == ["pull"]
    git.calls.clear()
    git.script["pull"] = _result(1, err="conflict")
    assert git_sync_utils.pull_rebase(Path(".")).returncode == 1
    assert git.calls == ["pull", "rebase"]


def test_a_stale_lock_is_only_removed_when_there_is(tmp_path):
    git_sync_utils.clear_stale_index_lock(tmp_path)   # no .git at all: fine
    (tmp_path / ".git").mkdir()
    lock = tmp_path / ".git" / "index.lock"
    lock.write_text("")
    git_sync_utils.clear_stale_index_lock(tmp_path)
    assert not lock.exists()


def test_run_git_runs_git_in_the_repo(tmp_path):
    if subprocess.run(["git", "--version"], capture_output=True).returncode != 0:
        pytest.skip("needs git")
    result = git_sync_utils.run_git(tmp_path, "init", "-q")
    assert result.returncode == 0 and (tmp_path / ".git").is_dir()
