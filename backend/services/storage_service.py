"""S3-compatible object storage client (Ceph Rook RGW) for the audio player,
chart map/pin images, vista backgrounds, and the reusable asset library."""
import re
import uuid
from typing import BinaryIO, Optional

import boto3
from botocore.client import Config

from config.settings import settings

_FORBIDDEN_CHARS = {"/", "\\", "\x00"}

ALLOWED_AUDIO_EXTENSIONS = {".mp3", ".ogg", ".oga", ".wav", ".flac", ".m4a", ".opus", ".aac", ".webm"}
ALLOWED_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"}

# Top-level prefixes used by other features sharing this bucket — never
# real albums, so list_albums() must skip them and create/rename must
# refuse to collide with them.
RESERVED_ALBUM_NAMES = {"charts", "vistas", "asset-library"}

ASSET_LIBRARY_PREFIX = "asset-library/"
_UNIQUE_PREFIX_RE = re.compile(r"^[0-9a-f]{8}-")


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


def _split_key(key: str) -> tuple[str, str]:
    parts = key.split("/")
    if len(parts) != 2:
        raise StorageError(f"Invalid track key: {key!r}")
    return _sanitize_segment(parts[0]), _sanitize_segment(parts[1])


def _sanitize_path(path: str) -> str:
    """Validate a (possibly multi-level) folder path: every segment must be
    a safe path component. Returns "" for the root."""
    segments = [s for s in (path or "").split("/") if s]
    return "/".join(_sanitize_segment(s) for s in segments)


def _validate_key(key: str) -> None:
    """Validate a (possibly multi-segment) object key: every segment must be
    a safe path component. Used for keys whose depth varies (e.g. chart
    assets), unlike `_split_key`'s fixed album/filename shape."""
    parts = (key or "").split("/")
    if not parts or not all(parts):
        raise StorageError(f"Invalid key: {key!r}")
    for part in parts:
        _sanitize_segment(part)


def list_albums() -> list[str]:
    client = _client()
    albums = []
    paginator = client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=settings.S3_BUCKET_NAME, Delimiter="/"):
        for prefix in page.get("CommonPrefixes", []):
            name = prefix["Prefix"].rstrip("/")
            if name not in RESERVED_ALBUM_NAMES:
                albums.append(name)
    return sorted(albums, key=str.lower)


def _check_not_reserved(name: str) -> None:
    if name.lower() in RESERVED_ALBUM_NAMES:
        raise StorageError(f"'{name}' is a reserved name and can't be used for an album")


def create_album(name: str) -> None:
    name = _sanitize_segment(name)
    _check_not_reserved(name)
    client = _client()
    client.put_object(Bucket=settings.S3_BUCKET_NAME, Key=f"{name}/.keep", Body=b"")


def rename_album(old_name: str, new_name: str) -> None:
    old_name = _sanitize_segment(old_name)
    new_name = _sanitize_segment(new_name)
    _check_not_reserved(new_name)
    if old_name == new_name:
        return

    client = _client()
    old_prefix = f"{old_name}/"
    new_prefix = f"{new_name}/"

    if list(client.list_objects_v2(Bucket=settings.S3_BUCKET_NAME, Prefix=new_prefix, MaxKeys=1).get("Contents", [])):
        raise StorageError(f"An album named '{new_name}' already exists")

    keys = []
    paginator = client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=settings.S3_BUCKET_NAME, Prefix=old_prefix):
        keys.extend(obj["Key"] for obj in page.get("Contents", []))
    if not keys:
        raise StorageError(f"Album not found: {old_name}")

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


def delete_album(name: str) -> None:
    name = _sanitize_segment(name)
    client = _client()
    prefix = f"{name}/"
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
    prefix = f"{album}/"
    tracks = []
    paginator = client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=settings.S3_BUCKET_NAME, Prefix=prefix):
        for obj in page.get("Contents", []):
            filename = obj["Key"][len(prefix):]
            if not filename or filename == ".keep":
                continue
            tracks.append({
                "key": obj["Key"],
                "name": filename,
                "size": obj["Size"],
                "last_modified": obj["LastModified"].isoformat(),
            })
    tracks.sort(key=lambda t: t["name"].lower())
    return tracks


def upload_track(album: str, filename: str, file_obj: BinaryIO, content_type: Optional[str]) -> dict:
    album = _sanitize_segment(album)
    filename = _sanitize_segment(filename)
    ext = filename[filename.rfind("."):].lower() if "." in filename else ""
    if ext not in ALLOWED_AUDIO_EXTENSIONS:
        raise StorageError(f"Unsupported audio file type: {ext or filename}")
    key = f"{album}/{filename}"
    client = _client()
    client.upload_fileobj(
        file_obj, settings.S3_BUCKET_NAME, key,
        ExtraArgs={"ContentType": content_type or "application/octet-stream"},
    )
    return {"key": key, "name": filename}


def delete_track(key: str) -> None:
    _split_key(key)
    client = _client()
    client.delete_object(Bucket=settings.S3_BUCKET_NAME, Key=key)


def _unique_filename(filename: str) -> str:
    """Prefixes a short random id onto the filename so replacing an image
    with a new upload of the same name never reuses the old S3 key. Reusing
    the key would return the same image_url as before, which Vue treats as
    unchanged (skips re-rendering the <img>) and which browsers hold onto
    under this endpoint's long immutable cache — so a GM's replacement
    would silently never show up, with no error anywhere.
    """
    return f"{uuid.uuid4().hex[:8]}-{filename}"


def _upload_image(key: str, filename: str, file_obj: BinaryIO, content_type: Optional[str]) -> dict:
    ext = filename[filename.rfind("."):].lower() if "." in filename else ""
    if ext not in ALLOWED_IMAGE_EXTENSIONS:
        raise StorageError(f"Unsupported image file type: {ext or filename}")
    client = _client()
    client.upload_fileobj(
        file_obj, settings.S3_BUCKET_NAME, key,
        ExtraArgs={"ContentType": content_type or "application/octet-stream"},
    )
    return {"key": key, "name": filename}


def upload_chart_image(chart_id: str, filename: str, file_obj: BinaryIO, content_type: Optional[str]) -> dict:
    chart_id = _sanitize_path(chart_id)
    filename = _sanitize_segment(filename)
    return _upload_image(f"charts/{chart_id}/map/{_unique_filename(filename)}", filename, file_obj, content_type)


def upload_pin_icon(chart_id: str, pin_id: str, filename: str, file_obj: BinaryIO, content_type: Optional[str]) -> dict:
    chart_id = _sanitize_path(chart_id)
    pin_id = _sanitize_segment(pin_id)
    filename = _sanitize_segment(filename)
    return _upload_image(f"charts/{chart_id}/pins/{pin_id}/{_unique_filename(filename)}", filename, file_obj, content_type)


def delete_chart_assets(chart_id: str) -> None:
    chart_id = _sanitize_path(chart_id)
    client = _client()
    prefix = f"charts/{chart_id}/"
    paginator = client.get_paginator("list_objects_v2")
    keys = []
    for page in paginator.paginate(Bucket=settings.S3_BUCKET_NAME, Prefix=prefix):
        keys.extend({"Key": obj["Key"]} for obj in page.get("Contents", []))
    for i in range(0, len(keys), 1000):
        batch = keys[i:i + 1000]
        if batch:
            client.delete_objects(Bucket=settings.S3_BUCKET_NAME, Delete={"Objects": batch})


def upload_vista_background(vista_id: str, filename: str, file_obj: BinaryIO, content_type: Optional[str]) -> dict:
    vista_id = _sanitize_path(vista_id)
    filename = _sanitize_segment(filename)
    return _upload_image(f"vistas/{vista_id}/background/{_unique_filename(filename)}", filename, file_obj, content_type)


def list_asset_library(path: str = "") -> dict:
    """Immediate subfolders and files directly under `path` (not recursive) —
    folders are plain S3 prefixes, nested arbitrarily deep, same idea as
    list_albums()/list_tracks() but with a variable number of levels."""
    path = _sanitize_path(path)
    prefix = f"{ASSET_LIBRARY_PREFIX}{path}/" if path else ASSET_LIBRARY_PREFIX
    client = _client()
    folders = []
    assets = []
    paginator = client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=settings.S3_BUCKET_NAME, Prefix=prefix, Delimiter="/"):
        for cp in page.get("CommonPrefixes", []):
            name = cp["Prefix"][len(prefix):].rstrip("/")
            if name:
                folders.append(name)
        for obj in page.get("Contents", []):
            filename = obj["Key"][len(prefix):]
            if not filename or filename == ".keep":
                continue
            assets.append({
                "key": obj["Key"],
                # Strip the anti-cache-collision prefix _unique_filename() adds
                # on upload so the library shows the file's original name.
                "name": _UNIQUE_PREFIX_RE.sub("", filename, count=1),
                "size": obj["Size"],
                "last_modified": obj["LastModified"].isoformat(),
            })
    folders.sort(key=str.lower)
    assets.sort(key=lambda a: a["name"].lower())
    return {"folders": folders, "assets": assets}


def create_asset_folder(path: str) -> None:
    path = _sanitize_path(path)
    if not path:
        raise StorageError("Folder path is required")
    client = _client()
    client.put_object(Bucket=settings.S3_BUCKET_NAME, Key=f"{ASSET_LIBRARY_PREFIX}{path}/.keep", Body=b"")


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


def rename_asset_folder(path: str, new_name: str) -> None:
    """Renames the leaf segment of `path`, keeping it under the same parent —
    e.g. rename_asset_folder("monsters/goblins", "orcs") -> "monsters/orcs"."""
    path = _sanitize_path(path)
    new_name = _sanitize_segment(new_name)
    if not path:
        raise StorageError("Folder path is required")

    parent, _, _leaf = path.rpartition("/")
    new_path = f"{parent}/{new_name}" if parent else new_name
    if path == new_path:
        return

    _move_prefix(
        f"{ASSET_LIBRARY_PREFIX}{path}/", f"{ASSET_LIBRARY_PREFIX}{new_path}/",
        not_found_label=f"Folder not found: {path}",
        exists_label=f"A folder already exists at '{new_path}'",
    )


def move_asset_folder(path: str, dest_parent_path: str) -> None:
    """Moves the folder at `path` to be a child of `dest_parent_path`,
    keeping its own leaf name — e.g. move_asset_folder("goblins", "monsters")
    -> "monsters/goblins". Used for drag-and-drop between folders."""
    path = _sanitize_path(path)
    dest_parent_path = _sanitize_path(dest_parent_path)
    if not path:
        raise StorageError("Folder path is required")

    leaf = path.rsplit("/", 1)[-1]
    new_path = f"{dest_parent_path}/{leaf}" if dest_parent_path else leaf
    if new_path == path:
        return
    if new_path == dest_parent_path or new_path.startswith(f"{path}/"):
        raise StorageError("Cannot move a folder into itself or one of its own subfolders")

    _move_prefix(
        f"{ASSET_LIBRARY_PREFIX}{path}/", f"{ASSET_LIBRARY_PREFIX}{new_path}/",
        not_found_label=f"Folder not found: {path}",
        exists_label=f"A folder already exists at '{new_path}'",
    )


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


def move_library_asset(key: str, dest_folder_path: str) -> dict:
    """Moves a single asset (by its full S3 key) into `dest_folder_path`,
    keeping its filename. Used for drag-and-drop between folders."""
    _validate_key(key)
    if not key.startswith(ASSET_LIBRARY_PREFIX):
        raise StorageError(f"Invalid asset key: {key!r}")
    dest_folder_path = _sanitize_path(dest_folder_path)

    filename = key.rsplit("/", 1)[-1]
    new_key = f"{ASSET_LIBRARY_PREFIX}{dest_folder_path}/{filename}" if dest_folder_path else f"{ASSET_LIBRARY_PREFIX}{filename}"
    _move_object(key, new_key)
    return {"key": new_key}


def move_track(key: str, dest_album: str) -> dict:
    """Moves a single track (by its "album/filename" key) into
    `dest_album`, keeping its filename. Used for drag-and-drop between
    albums in the player."""
    _split_key(key)
    dest_album = _sanitize_segment(dest_album)
    _check_not_reserved(dest_album)

    filename = key.rsplit("/", 1)[-1]
    new_key = f"{dest_album}/{filename}"
    _move_object(key, new_key)
    return {"key": new_key}


def delete_asset_folder(path: str) -> None:
    """Deletes a folder and everything nested inside it (cascading, like rm -rf)."""
    path = _sanitize_path(path)
    if not path:
        raise StorageError("Folder path is required")
    client = _client()
    prefix = f"{ASSET_LIBRARY_PREFIX}{path}/"
    paginator = client.get_paginator("list_objects_v2")
    keys = []
    for page in paginator.paginate(Bucket=settings.S3_BUCKET_NAME, Prefix=prefix):
        keys.extend({"Key": obj["Key"]} for obj in page.get("Contents", []))
    for i in range(0, len(keys), 1000):
        batch = keys[i:i + 1000]
        if batch:
            client.delete_objects(Bucket=settings.S3_BUCKET_NAME, Delete={"Objects": batch})


def upload_library_asset(path: str, filename: str, file_obj: BinaryIO, content_type: Optional[str]) -> dict:
    path = _sanitize_path(path)
    filename = _sanitize_segment(filename)
    prefix = f"{ASSET_LIBRARY_PREFIX}{path}/" if path else ASSET_LIBRARY_PREFIX
    return _upload_image(f"{prefix}{_unique_filename(filename)}", filename, file_obj, content_type)


def delete_library_asset(key: str) -> None:
    _validate_key(key)
    if not key.startswith(ASSET_LIBRARY_PREFIX):
        raise StorageError(f"Invalid asset key: {key!r}")
    client = _client()
    client.delete_object(Bucket=settings.S3_BUCKET_NAME, Key=key)


def delete_vista_assets(vista_id: str) -> None:
    vista_id = _sanitize_path(vista_id)
    client = _client()
    prefix = f"vistas/{vista_id}/"
    paginator = client.get_paginator("list_objects_v2")
    keys = []
    for page in paginator.paginate(Bucket=settings.S3_BUCKET_NAME, Prefix=prefix):
        keys.extend({"Key": obj["Key"]} for obj in page.get("Contents", []))
    for i in range(0, len(keys), 1000):
        batch = keys[i:i + 1000]
        if batch:
            client.delete_objects(Bucket=settings.S3_BUCKET_NAME, Delete={"Objects": batch})


def get_object_stream(key: str, range_header: Optional[str] = None) -> dict:
    _validate_key(key)
    client = _client()
    kwargs = {"Bucket": settings.S3_BUCKET_NAME, "Key": key}
    if range_header:
        kwargs["Range"] = range_header
    return client.get_object(**kwargs)
