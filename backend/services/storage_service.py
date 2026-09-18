"""S3-compatible object storage client (Ceph Rook RGW) for the audio player,
chart map/pin images, vista backgrounds, and the reusable asset library."""
import re
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
    chart_id = _sanitize_segment(chart_id)
    filename = _sanitize_segment(filename)
    return _upload_image(f"charts/{chart_id}/map/{filename}", filename, file_obj, content_type)


def upload_pin_icon(chart_id: str, pin_id: str, filename: str, file_obj: BinaryIO, content_type: Optional[str]) -> dict:
    chart_id = _sanitize_segment(chart_id)
    pin_id = _sanitize_segment(pin_id)
    filename = _sanitize_segment(filename)
    return _upload_image(f"charts/{chart_id}/pins/{pin_id}/{filename}", filename, file_obj, content_type)


def delete_chart_assets(chart_id: str) -> None:
    chart_id = _sanitize_segment(chart_id)
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
    vista_id = _sanitize_segment(vista_id)
    filename = _sanitize_segment(filename)
    return _upload_image(f"vistas/{vista_id}/background/{filename}", filename, file_obj, content_type)


def upload_library_asset_image(item_id: str, filename: str, file_obj: BinaryIO, content_type: Optional[str]) -> dict:
    item_id = _sanitize_segment(item_id)
    filename = _sanitize_segment(filename)
    return _upload_image(f"asset-library/{item_id}/{filename}", filename, file_obj, content_type)


def delete_library_asset(item_id: str) -> None:
    item_id = _sanitize_segment(item_id)
    client = _client()
    prefix = f"asset-library/{item_id}/"
    paginator = client.get_paginator("list_objects_v2")
    keys = []
    for page in paginator.paginate(Bucket=settings.S3_BUCKET_NAME, Prefix=prefix):
        keys.extend({"Key": obj["Key"]} for obj in page.get("Contents", []))
    for i in range(0, len(keys), 1000):
        batch = keys[i:i + 1000]
        if batch:
            client.delete_objects(Bucket=settings.S3_BUCKET_NAME, Delete={"Objects": batch})


def delete_vista_assets(vista_id: str) -> None:
    vista_id = _sanitize_segment(vista_id)
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
