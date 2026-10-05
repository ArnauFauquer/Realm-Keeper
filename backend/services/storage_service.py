"""S3-compatible object storage client (Ceph Rook RGW) for the audio player,
and the bucket helpers the Observatory's store uses (services/doc_backend.py).

How the bucket is laid out: one top-level prefix per kind of thing.

    player/<album>/<track>              audio, one folder per album
    observatory/<folders>/<file>        every document and the images they
                                        draw, in one tree (services/observatory.py)

A track's key, as the player and the notes see it, is "<album>/<track>"; the
`player/` in front of it is where it is stored, nobody else's business."""
from typing import BinaryIO, Optional

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


def _client():
    return boto3.client(
        "s3",
        endpoint_url=settings.S3_ENDPOINT_URL,
        aws_access_key_id=settings.S3_ACCESS_KEY,
        aws_secret_access_key=settings.S3_SECRET_KEY,
        region_name=settings.S3_REGION,
        config=Config(signature_version="s3v4"),
    )


def _sanitize_segment(name: str) -> str:
    """Validate a single path segment (album name or filename): no slashes, no traversal.

    Deliberately permissive otherwise — real filenames contain apostrophes,
    parentheses, ampersands, etc., and S3 keys accept almost any UTF-8.
    """
    name = (name or "").strip()
    if not name or name in (".", "..") or any(c in _FORBIDDEN_CHARS for c in name):
        raise StorageError(f"Invalid name: {name!r}")
    return name


def _validate_key(key: str) -> None:
    """Validate a (possibly multi-segment) object key: every segment must be
    a safe path component. A second check on the stored key a track is
    streamed from, beyond the album/file shape `_split_key` checks."""
    parts = (key or "").split("/")
    if not parts or not all(parts):
        raise StorageError(f"Invalid key: {key!r}")
    for part in parts:
        _sanitize_segment(part)


def _extension(filename: str) -> str:
    return filename[filename.rfind("."):].lower() if "." in filename else ""


def content_type_for(key: str) -> str:
    """The Content-Type to serve an object with, derived from its key's
    extension (see AUDIO_CONTENT_TYPES) — never the stored metadata, which
    objects uploaded before this check may have taken from the client."""
    ext = _extension(key)
    return AUDIO_CONTENT_TYPES.get(ext) or IMAGE_CONTENT_TYPES.get(ext) or "application/octet-stream"


def _split_key(key: str) -> tuple[str, str]:
    """A track's key, "<album>/<file>", as its album and file name."""
    parts = key.split("/")
    if len(parts) != 2:
        raise StorageError(f"Invalid track key: {key!r}")
    return _sanitize_segment(parts[0]), _sanitize_segment(parts[1])


def _track_key(album: str, filename: str) -> str:
    """Where a track is stored. Whatever a track's key says, it can only name
    something under `player/`: nothing else in the bucket is reachable by it."""
    return f"{PLAYER_PREFIX}{album}/{filename}"


def list_albums() -> list[str]:
    client = _client()
    albums = []
    paginator = client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=settings.S3_BUCKET_NAME, Prefix=PLAYER_PREFIX, Delimiter="/"):
        for prefix in page.get("CommonPrefixes", []):
            albums.append(prefix["Prefix"][len(PLAYER_PREFIX):].rstrip("/"))
    return sorted(albums, key=str.lower)


def create_album(name: str) -> None:
    name = _sanitize_segment(name)
    client = _client()
    client.put_object(Bucket=settings.S3_BUCKET_NAME, Key=f"{PLAYER_PREFIX}{name}/.keep", Body=b"")


def rename_album(old_name: str, new_name: str) -> None:
    old_name = _sanitize_segment(old_name)
    new_name = _sanitize_segment(new_name)
    if old_name == new_name:
        return
    _move_prefix(
        f"{PLAYER_PREFIX}{old_name}/", f"{PLAYER_PREFIX}{new_name}/",
        not_found_label=f"Album not found: {old_name}",
        exists_label=f"An album named '{new_name}' already exists",
    )


def delete_album(name: str) -> None:
    name = _sanitize_segment(name)
    client = _client()
    prefix = f"{PLAYER_PREFIX}{name}/"
    paginator = client.get_paginator("list_objects_v2")
    keys = []
    for page in paginator.paginate(Bucket=settings.S3_BUCKET_NAME, Prefix=prefix):
        keys.extend({"Key": obj["Key"]} for obj in page.get("Contents", []))
    for i in range(0, len(keys), 1000):
        batch = keys[i:i + 1000]
        if batch:
            client.delete_objects(Bucket=settings.S3_BUCKET_NAME, Delete={"Objects": batch})


def list_tracks(album: str) -> list[dict]:
    album = _sanitize_segment(album)
    client = _client()
    prefix = f"{PLAYER_PREFIX}{album}/"
    tracks = []
    paginator = client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=settings.S3_BUCKET_NAME, Prefix=prefix):
        for obj in page.get("Contents", []):
            filename = obj["Key"][len(prefix):]
            if not filename or filename == ".keep":
                continue
            tracks.append({
                "key": f"{album}/{filename}",
                "name": filename,
                "size": obj["Size"],
                "last_modified": obj["LastModified"].isoformat(),
            })
    tracks.sort(key=lambda t: t["name"].lower())
    return tracks


def upload_track(album: str, filename: str, file_obj: BinaryIO, content_type: Optional[str]) -> dict:
    album = _sanitize_segment(album)
    filename = _sanitize_segment(filename)
    ext = _extension(filename)
    if ext not in ALLOWED_AUDIO_EXTENSIONS:
        raise StorageError(f"Unsupported audio file type: {ext or filename}")
    client = _client()
    client.upload_fileobj(
        file_obj, settings.S3_BUCKET_NAME, _track_key(album, filename),
        ExtraArgs={"ContentType": AUDIO_CONTENT_TYPES[ext]},
    )
    return {"key": f"{album}/{filename}", "name": filename}


def delete_track(key: str) -> None:
    album, filename = _split_key(key)
    client = _client()
    client.delete_object(Bucket=settings.S3_BUCKET_NAME, Key=_track_key(album, filename))


def rename_track(key: str, new_name: str) -> dict:
    """Renames a single track's filename, keeping it in the same album. S3
    has no rename, so this copies to a new key then deletes the original
    (via _move_object) — the same technique move_track uses to change an
    object's folder instead of its filename."""
    album, filename = _split_key(key)
    new_name = _sanitize_segment(new_name)
    ext = new_name[new_name.rfind("."):].lower() if "." in new_name else ""
    if ext not in ALLOWED_AUDIO_EXTENSIONS:
        raise StorageError(f"Unsupported audio file type: {ext or new_name}")

    _move_object(_track_key(album, filename), _track_key(album, new_name))
    return {"key": f"{album}/{new_name}", "name": new_name}


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

    for key in keys:
        client.copy_object(
            Bucket=settings.S3_BUCKET_NAME,
            CopySource={"Bucket": settings.S3_BUCKET_NAME, "Key": key},
            Key=new_prefix + key[len(old_prefix):],
        )
    for i in range(0, len(keys), 1000):
        batch = keys[i:i + 1000]
        if batch:
            client.delete_objects(Bucket=settings.S3_BUCKET_NAME, Delete={"Objects": [{"Key": k} for k in batch]})


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


def move_track(key: str, dest_album: str) -> dict:
    """Moves a single track (by its "album/filename" key) into
    `dest_album`, keeping its filename. Used for drag-and-drop between
    albums in the player."""
    album, filename = _split_key(key)
    dest_album = _sanitize_segment(dest_album)
    _move_object(_track_key(album, filename), _track_key(dest_album, filename))
    return {"key": f"{dest_album}/{filename}"}


def get_track_stream(key: str, range_header: Optional[str] = None) -> dict:
    album, filename = _split_key(key)
    return _get_object_stream(_track_key(album, filename), range_header)


def _get_object_stream(key: str, range_header: Optional[str] = None) -> dict:
    _validate_key(key)
    client = _client()
    kwargs = {"Bucket": settings.S3_BUCKET_NAME, "Key": key}
    if range_header:
        kwargs["Range"] = range_header
    return client.get_object(**kwargs)
