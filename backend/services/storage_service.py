"""S3-compatible object storage client (Ceph Rook RGW) for the audio player."""
import re
from typing import BinaryIO, Optional

import boto3
from botocore.client import Config

from config.settings import settings

_FORBIDDEN_CHARS = {"/", "\\", "\x00"}

ALLOWED_AUDIO_EXTENSIONS = {".mp3", ".ogg", ".oga", ".wav", ".flac", ".m4a", ".opus", ".aac", ".webm"}


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


def list_albums() -> list[str]:
    client = _client()
    albums = []
    paginator = client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=settings.S3_BUCKET_NAME, Delimiter="/"):
        for prefix in page.get("CommonPrefixes", []):
            albums.append(prefix["Prefix"].rstrip("/"))
    return sorted(albums, key=str.lower)


def create_album(name: str) -> None:
    name = _sanitize_segment(name)
    client = _client()
    client.put_object(Bucket=settings.S3_BUCKET_NAME, Key=f"{name}/.keep", Body=b"")


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


def get_object_stream(key: str, range_header: Optional[str] = None) -> dict:
    _split_key(key)
    client = _client()
    kwargs = {"Bucket": settings.S3_BUCKET_NAME, "Key": key}
    if range_header:
        kwargs["Range"] = range_header
    return client.get_object(**kwargs)
