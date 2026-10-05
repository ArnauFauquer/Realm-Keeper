import logging
import re
import subprocess
import threading
from pathlib import Path
from typing import List, Union

_URL_CREDENTIALS_RE = re.compile(r"(\w+://)[^/@\s]+@")

logger = logging.getLogger(__name__)

AnyLock = Union[threading.Lock, threading.RLock]


def redact_credentials(text: str) -> str:
    """REPO_URL usually embeds an access token (https://TOKEN@github.com/...),
    and git echoes the remote URL back in its own errors — strip it before
    that text reaches a log line or an HTTP error response."""
    return _URL_CREDENTIALS_RE.sub(r"\1***@", text)


class GitCommitError(Exception):
    """Raised when committing or pushing a vault change to git fails."""

    def __init__(self, message: str):
        super().__init__(redact_credentials(message))


def run_git(repo_path: Path, *args: str, timeout: float = 30) -> subprocess.CompletedProcess:
    """`git -C <repo> <args>`. A git that outlasts `timeout` is killed, which
    can leave its `index.lock` behind and block every git after it: that lock
    is removed (only ever called under the vault's lock, so no other git of
    ours is running) and the timeout raised as a GitCommitError."""
    try:
        return subprocess.run(["git", "-C", str(repo_path), *args], capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        clear_stale_index_lock(repo_path)
        raise GitCommitError(f"git {args[0]} timed out")


def clear_stale_index_lock(repo_path: Path) -> None:
    """Removes the `index.lock` a killed git left. Only safe while no other
    git runs in the repository (at startup, or under the vault's lock)."""
    stale = Path(repo_path) / ".git" / "index.lock"
    if stale.exists():
        logger.warning("Removing a stale .git/index.lock")
        stale.unlink(missing_ok=True)


def pull_rebase(repo_path: Path, timeout: float = 120) -> subprocess.CompletedProcess:
    """Brings in what the remote has, replaying ours (commits a failed push
    left) on top. A rebase that stops on a conflict (the same note edited in
    Obsidian and in the app) is aborted: the vault stays as it was, rather
    than mid-rebase with conflict markers in the notes it serves."""
    result = run_git(repo_path, "pull", "--rebase", "--autostash", timeout=timeout)
    if result.returncode != 0:
        run_git(repo_path, "rebase", "--abort")
    return result


def commit_and_push(
    repo_path: Path,
    lock: AnyLock,
    rel_paths: List[str],
    message: str,
    author_name: str,
    author_email: str,
) -> None:
    """Stages `rel_paths` (relative to `repo_path`), commits and pushes them
    to the vault's git repo. Raises GitCommitError on failure.

    Callers must have already written the files to disk before calling this
    (under the same `lock`, which may be re-entrant, so nothing else writes
    them in between).
    """
    with lock:
        # Best-effort: reduces (but does not guarantee against) a rejected
        # push if the remote moved on since our last sync.
        run_git(repo_path, "pull", "--ff-only")

        # "-A --" (rather than a bare "add <path>") so a pathspec pointing at
        # a file/dir that was just deleted from disk stages the removal too.
        add_result = run_git(repo_path, "add", "-A", "--", *rel_paths)
        if add_result.returncode != 0:
            raise GitCommitError(f"git add failed: {add_result.stderr.strip()}")

        commit_result = run_git(
            repo_path, "-c", f"user.name={author_name}", "-c", f"user.email={author_email}", "commit", "-m", message,
        )
        if commit_result.returncode != 0:
            output = commit_result.stdout + commit_result.stderr
            if "nothing to commit" in output:
                raise GitCommitError("No changes to save.")
            raise GitCommitError(f"git commit failed: {output.strip()}")

        push_result = run_git(repo_path, "push", timeout=60)
        if push_result.returncode != 0:
            pull_rebase(repo_path, timeout=30)
            push_retry = run_git(repo_path, "push", timeout=60)
            if push_retry.returncode != 0:
                raise GitCommitError(f"git push failed: {push_retry.stderr.strip()}")
