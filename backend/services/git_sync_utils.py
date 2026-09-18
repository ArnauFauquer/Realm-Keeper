import subprocess
import threading
from pathlib import Path
from typing import List


class GitCommitError(Exception):
    """Raised when committing or pushing a vault change to git fails."""
    pass


def commit_and_push(
    repo_path: Path,
    lock: threading.Lock,
    rel_paths: List[str],
    message: str,
    author_name: str,
    author_email: str,
) -> None:
    """Stages `rel_paths` (relative to `repo_path`), commits and pushes them
    to the vault's git repo. Raises GitCommitError on failure.

    Callers must have already written the files to disk before calling this.
    """
    with lock:
        # Best-effort: reduces (but does not guarantee against) a rejected
        # push if the remote moved on since our last sync.
        subprocess.run(
            ["git", "-C", str(repo_path), "pull", "--ff-only"],
            capture_output=True, text=True, timeout=30
        )

        # "-A --" (rather than a bare "add <path>") so a pathspec pointing at
        # a file/dir that was just deleted from disk stages the removal too.
        add_result = subprocess.run(
            ["git", "-C", str(repo_path), "add", "-A", "--", *rel_paths],
            capture_output=True, text=True, timeout=30
        )
        if add_result.returncode != 0:
            raise GitCommitError(f"git add failed: {add_result.stderr.strip()}")

        commit_result = subprocess.run(
            ["git", "-C", str(repo_path),
             "-c", f"user.name={author_name}",
             "-c", f"user.email={author_email}",
             "commit", "-m", message],
            capture_output=True, text=True, timeout=30
        )
        if commit_result.returncode != 0:
            output = commit_result.stdout + commit_result.stderr
            if "nothing to commit" in output:
                raise GitCommitError("No changes to save.")
            raise GitCommitError(f"git commit failed: {output.strip()}")

        push_result = subprocess.run(
            ["git", "-C", str(repo_path), "push"],
            capture_output=True, text=True, timeout=60
        )
        if push_result.returncode != 0:
            subprocess.run(
                ["git", "-C", str(repo_path), "pull", "--rebase"],
                capture_output=True, text=True, timeout=30
            )
            push_retry = subprocess.run(
                ["git", "-C", str(repo_path), "push"],
                capture_output=True, text=True, timeout=60
            )
            if push_retry.returncode != 0:
                raise GitCommitError(f"git push failed: {push_retry.stderr.strip()}")
