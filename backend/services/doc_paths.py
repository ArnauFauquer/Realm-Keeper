"""Names and paths of documents (charts, vistas, encounters...) and the folders
that hold them. A document's id is its folder path plus its own slug
("goblins/cave-ambush"), so every segment is checked before it reaches a
storage key."""
import re


def sanitize_folder_path(path: str) -> str:
    """Validate a (possibly multi-level) folder path: every segment must be
    a safe path component. Returns "" for the root."""
    segments = [s for s in (path or "").strip("/").split("/") if s]
    for s in segments:
        # Dot-prefixed covers ".", ".." and hidden names like ".git".
        if s.startswith(".") or "\\" in s or "\x00" in s:
            raise ValueError(f"Invalid folder path: {path!r}")
    return "/".join(segments)


def sanitize_folder_name(name: str) -> str:
    name = (name or "").strip()
    if not name or name.startswith(".") or "/" in name or "\\" in name or "\x00" in name:
        raise ValueError(f"Invalid folder name: {name!r}")
    return name


def sanitize_id(item_id: str) -> str:
    """A document id: a non-empty folder path."""
    normalized = sanitize_folder_path(item_id)
    if not normalized:
        raise ValueError(f"Invalid id: {item_id!r}")
    return normalized


def slugify(name: str, fallback: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", (name or "").strip().lower()).strip("-")
    return slug or fallback
