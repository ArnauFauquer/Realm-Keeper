"""Names and paths of documents (charts, vistas, encounters...) and the folders
that hold them. A document's id is its folder path plus its own slug
("goblins/cave-ambush"), so every segment is checked before it reaches a
storage key."""
import re
import unicodedata

# A storage key is at most 1024 bytes (S3): a path or a name longer than these
# is refused as the caller's mistake, rather than failing in the store.
MAX_NAME_BYTES = 200
MAX_PATH_BYTES = 800


def _check_length(text: str, limit: int, what: str) -> None:
    if len(text.encode("utf-8")) > limit:
        raise ValueError(f"{what} is too long (at most {limit} bytes)")


def sanitize_folder_path(path: str) -> str:
    """Validate a (possibly multi-level) folder path: every segment must be
    a safe path component. Returns "" for the root."""
    segments = [s for s in (path or "").strip("/").split("/") if s]
    for s in segments:
        # Dot-prefixed covers ".", ".." and hidden names like ".git".
        if s.startswith(".") or "\\" in s or "\x00" in s:
            raise ValueError(f"Invalid folder path: {path!r}")
        _check_length(s, MAX_NAME_BYTES, "A name")
    normalized = "/".join(segments)
    _check_length(normalized, MAX_PATH_BYTES, "A path")
    return normalized


def sanitize_folder_name(name: str) -> str:
    name = (name or "").strip()
    if not name or name.startswith(".") or "/" in name or "\\" in name or "\x00" in name:
        raise ValueError(f"Invalid folder name: {name!r}")
    _check_length(name, MAX_NAME_BYTES, "A name")
    return name


def sanitize_id(item_id: str) -> str:
    """A document id: a non-empty folder path."""
    normalized = sanitize_folder_path(item_id)
    if not normalized:
        raise ValueError(f"Invalid id: {item_id!r}")
    return normalized


def slug(text: str) -> str:
    """Lowercase ASCII with hyphens, accents folded rather than dropped:
    "Jabalí Gigante" -> "jabali-gigante". May be empty ("龍の巣")."""
    ascii_text = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", "-", ascii_text.lower()).strip("-")


def slugify(name: str, fallback: str) -> str:
    return slug(name) or fallback
