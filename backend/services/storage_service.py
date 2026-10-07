"""The S3 client and bucket helpers the S3 store uses (services/doc_backend.py),
and what every store shares: how it is laid out, and the files it takes.

How a store (the bucket, or the folder of STORAGE_LOCAL_PATH) is laid out: one
top-level prefix per kind of thing.

    player/<album>/<track>              audio, one folder per album
    observatory/<folders>/<file>        every document and the images they
                                        draw, in one tree (services/observatory.py)

A track's key, as the player and the notes see it, is "<album>/<track>"; the
`player/` in front of it is where it is stored, nobody else's business."""
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import Iterable, Iterator

import boto3
from botocore.client import Config

from config.settings import settings

_FORBIDDEN_CHARS = {"/", "\\", "\x00"}

# The Content-Type every object is stored and served with comes from its
# extension, never from the uploader: a client-supplied "text/html" on a
# ".png" would otherwise be served back as a page on the app's own origin.
AUDIO_CONTENT_TYPES = {
    ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".oga": "audio/ogg", ".wav": "audio/wav",
    ".flac": "audio/flac", ".m4a": "audio/mp4", ".opus": "audio/opus", ".aac": "audio/aac",
    ".webm": "audio/webm",
}
IMAGE_CONTENT_TYPES = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
    ".gif": "image/gif", ".svg": "image/svg+xml",
}
ALLOWED_AUDIO_EXTENSIONS = set(AUDIO_CONTENT_TYPES)
ALLOWED_IMAGE_EXTENSIONS = set(IMAGE_CONTENT_TYPES)

PLAYER_PREFIX = "player/"
OBSERVATORY_PREFIX = "observatory/"
# Where the app serves an Observatory image from; documents (charts, vistas,
# sheets...) and notes refer to images by URLs starting with this.
IMAGE_URL_PREFIX = "/api/observatory/images/"


class StorageError(Exception):
    pass


_shared_client = None
_shared_client_lock = threading.Lock()
# Copies of a folder being moved, at once.
COPY_WORKERS = 8


def _client():
    """The one S3 client, made the first time it is needed. A client is safe
    to share between threads and keeps its connections open; making one per
    call cost a few milliseconds of CPU and a new TLS connection each time,
    and making them from several threads at once (boto3's default session
    isn't thread-safe) could fail."""
    global _shared_client
    if _shared_client is None:
        with _shared_client_lock:
            if _shared_client is None:
                _shared_client = boto3.session.Session().client(
                    "s3",
                    # None (not ""): AWS itself, found by region.
                    endpoint_url=settings.S3_ENDPOINT_URL or None,
                    aws_access_key_id=settings.S3_ACCESS_KEY,
                    aws_secret_access_key=settings.S3_SECRET_KEY,
                    region_name=settings.S3_REGION,
                    config=Config(signature_version="s3v4", max_pool_connections=2 * COPY_WORKERS),
                )
    return _shared_client


def delete_keys(client, keys: Iterable[str]) -> None:
    """Deletes `keys`, a thousand per request. S3 answers a batch with the
    keys it could not delete instead of failing: those are raised."""
    keys = list(keys)
    for i in range(0, len(keys), 1000):
        response = client.delete_objects(
            Bucket=settings.S3_BUCKET_NAME, Delete={"Objects": [{"Key": key} for key in keys[i:i + 1000]]},
        )
        errors = (response or {}).get("Errors") or []
        if errors:
            first = errors[0]
            raise StorageError(f"Could not delete {len(errors)} files ({first.get('Key')}: {first.get('Message') or first.get('Code')})")


def is_missing(e: Exception) -> bool:
    """Whether a botocore ClientError says the object isn't there."""
    code = getattr(e, "response", {}).get("Error", {}).get("Code")
    return code in ("NoSuchKey", "404", "NotFound")


def stream_body(body, chunk_size: int = 64 * 1024) -> Iterator[bytes]:
    """An object's bytes, in chunks, from get_object's StreamingBody, which
    is closed however the reading ends (a viewer that hangs up halfway, a seek
    in a track) so its connection goes back to the pool. Closed with close(),
    not `with`: a `with` on a StreamingBody hands out the raw urllib3 stream,
    which has no iter_chunks (that served no image in 0.4.0)."""
    try:
        yield from body.iter_chunks(chunk_size=chunk_size)
    finally:
        body.close()


def _sanitize_segment(name: str) -> str:
    """Validate a single path segment (album name or filename): no slashes, no traversal.

    Deliberately permissive otherwise — real filenames contain apostrophes,
    parentheses, ampersands, etc., and S3 keys accept almost any UTF-8.
    """
    name = (name or "").strip()
    if not name or name in (".", "..") or any(c in _FORBIDDEN_CHARS for c in name):
        raise StorageError(f"Invalid name: {name!r}")
    return name


def _extension(filename: str) -> str:
    return filename[filename.rfind("."):].lower() if "." in filename else ""


def content_type_for(key: str) -> str:
    """The Content-Type to serve an object with, derived from its key's
    extension (see AUDIO_CONTENT_TYPES) — never the stored metadata, which
    objects uploaded before this check may have taken from the client."""
    ext = _extension(key)
    return AUDIO_CONTENT_TYPES.get(ext) or IMAGE_CONTENT_TYPES.get(ext) or "application/octet-stream"


def _move_prefix(old_prefix: str, new_prefix: str, not_found_label: str, exists_label: str) -> None:
    """Copies every object under `old_prefix` to the same relative key under
    `new_prefix`, then deletes the originals — the S3 equivalent of `mv` for
    a "directory" of objects, since S3 has no native move/rename."""
    client = _client()

    if list(client.list_objects_v2(Bucket=settings.S3_BUCKET_NAME, Prefix=new_prefix, MaxKeys=1).get("Contents", [])):
        raise StorageError(exists_label)

    keys = []
    paginator = client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=settings.S3_BUCKET_NAME, Prefix=old_prefix):
        keys.extend(obj["Key"] for obj in page.get("Contents", []))
    if not keys:
        raise StorageError(not_found_label)

    def copy(key: str) -> None:
        client.copy_object(
            Bucket=settings.S3_BUCKET_NAME,
            CopySource={"Bucket": settings.S3_BUCKET_NAME, "Key": key},
            Key=new_prefix + key[len(old_prefix):],
        )

    # Several at once: a folder of a few hundred images moved one copy after
    # another could outlast the request. Every copy is done (or one raised)
    # before anything is deleted, so a failure never loses a file.
    with ThreadPoolExecutor(max_workers=COPY_WORKERS) as pool:
        list(pool.map(copy, keys))
    delete_keys(client, keys)


def _move_object(old_key: str, new_key: str) -> None:
    """Copies a single S3 object to `new_key` then deletes the original —
    the S3 equivalent of `mv` for one object, since S3 has no native
    move/rename. Shared by every "drag a single item into a folder" move."""
    if old_key == new_key:
        return
    client = _client()
    client.copy_object(
        Bucket=settings.S3_BUCKET_NAME,
        CopySource={"Bucket": settings.S3_BUCKET_NAME, "Key": old_key},
        Key=new_key,
    )
    client.delete_object(Bucket=settings.S3_BUCKET_NAME, Key=old_key)
