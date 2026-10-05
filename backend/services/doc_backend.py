"""Where the Observatory's files live: the documents (charts, vistas,
encounters, battlemaps, characters, adversaries), as JSON text, and the images
they draw. One small interface, two stores:

- S3 (the bucket the app already uses for audio and images), which survives a
  redeploy and needs no lock or commit: a write is one PUT.
- A directory on disk, for running without object storage (local development,
  tests).

Keys look like "observatory/goblins/cave-ambush.encounter.json"; a prefix
is a key ending in "/". Both stores treat a prefix as a directory: listing,
deleting and moving work on everything under it.
"""
import os
import shutil
import tempfile
from abc import ABC, abstractmethod
from pathlib import Path
from typing import BinaryIO, Iterator, List, Optional, Tuple

from botocore.exceptions import ClientError

from config.settings import settings
from services import storage_service
from services.storage_service import StorageError


class DocBackendError(ValueError):
    """The request can't be done (a move onto something that exists, a move of
    something that doesn't). Not a storage failure."""


class DocBackend(ABC):
    @abstractmethod
    def get(self, key: str) -> Optional[str]:
        """The text stored at `key`, or None."""

    @abstractmethod
    def put(self, key: str, text: str) -> None: ...

    @abstractmethod
    def put_file(self, key: str, file_obj: BinaryIO, content_type: str) -> None:
        """Stores a binary file (an image) read from `file_obj`."""

    @abstractmethod
    def open(self, key: str) -> Optional[Tuple[Iterator[bytes], int]]:
        """The bytes stored at `key`, in chunks, and how many there are; or None."""

    @abstractmethod
    def exists(self, key: str) -> bool: ...

    @abstractmethod
    def delete(self, key: str) -> None: ...

    @abstractmethod
    def move(self, old_key: str, new_key: str) -> None:
        """Raises DocBackendError if there is nothing at `old_key` or
        something already at `new_key`."""

    @abstractmethod
    def list_keys(self, prefix: str) -> List[str]:
        """Every key under `prefix`, at any depth."""

    @abstractmethod
    def delete_prefix(self, prefix: str) -> None: ...

    @abstractmethod
    def move_prefix(self, old_prefix: str, new_prefix: str) -> None:
        """Raises DocBackendError if there is nothing at `old_prefix` or
        something already at `new_prefix`."""


def _check_key(key: str) -> None:
    if not key or any(part in ("", ".", "..") for part in key.rstrip("/").split("/")) or "\\" in key or "\x00" in key:
        raise ValueError(f"Invalid key: {key!r}")


class LocalDocBackend(DocBackend):
    def __init__(self, root: Path):
        self.root = Path(root)

    def _path(self, key: str) -> Path:
        _check_key(key)
        return self.root / key

    def get(self, key: str) -> Optional[str]:
        path = self._path(key)
        return path.read_text(encoding="utf-8") if path.is_file() else None

    def _write(self, key: str, write) -> None:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        # Written beside the target and renamed over it, so a crash mid-write
        # can't leave half a file behind.
        fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".tmp-")
        try:
            with os.fdopen(fd, "wb") as f:
                write(f)
            os.replace(tmp, path)
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise

    def put(self, key: str, text: str) -> None:
        self._write(key, lambda f: f.write(text.encode("utf-8")))

    def put_file(self, key: str, file_obj: BinaryIO, content_type: str) -> None:
        self._write(key, lambda f: shutil.copyfileobj(file_obj, f))

    def open(self, key: str) -> Optional[Tuple[Iterator[bytes], int]]:
        path = self._path(key)
        if not path.is_file():
            return None

        def chunks() -> Iterator[bytes]:
            with path.open("rb") as f:
                while chunk := f.read(64 * 1024):
                    yield chunk
        return chunks(), path.stat().st_size

    def exists(self, key: str) -> bool:
        return self._path(key).is_file()

    def delete(self, key: str) -> None:
        self._path(key).unlink(missing_ok=True)

    def move(self, old_key: str, new_key: str) -> None:
        old, new = self._path(old_key), self._path(new_key)
        if not old.is_file():
            raise DocBackendError("Not found")
        if new.exists():
            raise DocBackendError("Something already exists there")
        new.parent.mkdir(parents=True, exist_ok=True)
        old.rename(new)

    def list_keys(self, prefix: str) -> List[str]:
        base = self._path(prefix)
        if not base.is_dir():
            return []
        return sorted(
            p.relative_to(self.root).as_posix()
            for p in base.rglob("*") if p.is_file() and not p.name.startswith(".tmp-")
        )

    def delete_prefix(self, prefix: str) -> None:
        base = self._path(prefix)
        if base.is_dir():
            shutil.rmtree(base)

    def move_prefix(self, old_prefix: str, new_prefix: str) -> None:
        old, new = self._path(old_prefix), self._path(new_prefix)
        if not old.is_dir():
            raise DocBackendError("Not found")
        if new.exists():
            raise DocBackendError("Something already exists there")
        new.parent.mkdir(parents=True, exist_ok=True)
        old.rename(new)


class S3DocBackend(DocBackend):
    def get(self, key: str) -> Optional[str]:
        _check_key(key)
        try:
            body = storage_service._client().get_object(Bucket=settings.S3_BUCKET_NAME, Key=key)["Body"]
        except ClientError as e:
            if e.response.get("Error", {}).get("Code") in ("NoSuchKey", "404"):
                return None
            raise
        return body.read().decode("utf-8")

    def put(self, key: str, text: str) -> None:
        _check_key(key)
        storage_service._client().put_object(
            Bucket=settings.S3_BUCKET_NAME, Key=key, Body=text.encode("utf-8"), ContentType="application/json",
        )

    def put_file(self, key: str, file_obj: BinaryIO, content_type: str) -> None:
        _check_key(key)
        storage_service._client().upload_fileobj(
            file_obj, settings.S3_BUCKET_NAME, key, ExtraArgs={"ContentType": content_type},
        )

    def open(self, key: str) -> Optional[Tuple[Iterator[bytes], int]]:
        _check_key(key)
        try:
            obj = storage_service._client().get_object(Bucket=settings.S3_BUCKET_NAME, Key=key)
        except ClientError as e:
            if e.response.get("Error", {}).get("Code") in ("NoSuchKey", "404"):
                return None
            raise
        return obj["Body"].iter_chunks(chunk_size=64 * 1024), obj["ContentLength"]

    def exists(self, key: str) -> bool:
        _check_key(key)
        try:
            storage_service._client().head_object(Bucket=settings.S3_BUCKET_NAME, Key=key)
        except ClientError as e:
            if e.response.get("Error", {}).get("Code") in ("NoSuchKey", "404", "NotFound"):
                return False
            raise
        return True

    def delete(self, key: str) -> None:
        _check_key(key)
        storage_service._client().delete_object(Bucket=settings.S3_BUCKET_NAME, Key=key)

    def move(self, old_key: str, new_key: str) -> None:
        _check_key(old_key)
        _check_key(new_key)
        if not self.exists(old_key):
            raise DocBackendError("Not found")
        if self.exists(new_key):
            raise DocBackendError("Something already exists there")
        storage_service._move_object(old_key, new_key)

    def list_keys(self, prefix: str) -> List[str]:
        _check_key(prefix)
        keys: List[str] = []
        paginator = storage_service._client().get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=settings.S3_BUCKET_NAME, Prefix=prefix):
            keys.extend(obj["Key"] for obj in page.get("Contents", []))
        return sorted(keys)

    def delete_prefix(self, prefix: str) -> None:
        keys = self.list_keys(prefix)
        client = storage_service._client()
        for i in range(0, len(keys), 1000):
            client.delete_objects(
                Bucket=settings.S3_BUCKET_NAME,
                Delete={"Objects": [{"Key": key} for key in keys[i:i + 1000]]},
            )

    def move_prefix(self, old_prefix: str, new_prefix: str) -> None:
        _check_key(old_prefix)
        _check_key(new_prefix)
        try:
            storage_service._move_prefix(old_prefix, new_prefix, "Not found", "Something already exists there")
        except StorageError as e:
            raise DocBackendError(str(e))


def default_doc_backend() -> DocBackend:
    """S3 when the app has an endpoint configured, otherwise a local folder."""
    if settings.S3_ENDPOINT_URL:
        return S3DocBackend()
    return LocalDocBackend(settings.DOCS_LOCAL_PATH)
