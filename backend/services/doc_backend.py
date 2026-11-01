"""Where everything but the notes lives: the Observatory's documents (charts,
vistas, encounters, battlemaps, characters, adversaries), as JSON text, the
images they draw, and the player's audio. One small interface, two stores,
chosen by STORAGE_BACKEND:

- S3 (any S3-compatible bucket: MinIO, Ceph RGW, AWS...), which survives a
  redeploy and needs no lock or commit: a write is one PUT.
- A directory on disk (a Docker volume, or a folder when developing), laid out
  as the bucket is, so a store can be copied from one to the other as files.

Keys look like "observatory/goblins/cave-ambush.encounter.json"; a prefix
is a key ending in "/". Both stores treat a prefix as a directory: listing,
deleting and moving work on everything under it.
"""
import os
import shutil
import tempfile
from abc import ABC, abstractmethod
from pathlib import Path
from datetime import datetime, timezone
from typing import BinaryIO, Iterator, List, NamedTuple, Optional, Tuple

from botocore.exceptions import ClientError

from config.settings import settings
from services import storage_service
from services.storage_service import StorageError


class StoredFile(NamedTuple):
    key: str
    size: int
    modified: datetime


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
    def open_range(self, key: str, start: int, end: int) -> Optional[Iterator[bytes]]:
        """Bytes `start` to `end` (both included) of the file at `key`, in
        chunks; or None. For a track the player seeks in."""

    @abstractmethod
    def size(self, key: str) -> Optional[int]:
        """How many bytes the file at `key` has, or None if there is none."""

    def exists(self, key: str) -> bool:
        return self.size(key) is not None

    @abstractmethod
    def delete(self, key: str) -> None: ...

    @abstractmethod
    def move(self, old_key: str, new_key: str) -> None:
        """Raises DocBackendError if there is nothing at `old_key` or
        something already at `new_key`."""

    def list_keys(self, prefix: str) -> List[str]:
        """Every key under `prefix`, at any depth."""
        return [f.key for f in self.list_files(prefix)]

    @abstractmethod
    def list_files(self, prefix: str) -> List[StoredFile]:
        """Every file under `prefix`, at any depth, with its size and when it
        was last written; sorted by key."""

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

    def open_range(self, key: str, start: int, end: int) -> Optional[Iterator[bytes]]:
        path = self._path(key)
        if not path.is_file():
            return None

        def chunks() -> Iterator[bytes]:
            with path.open("rb") as f:
                f.seek(start)
                left = end - start + 1
                while left > 0 and (chunk := f.read(min(64 * 1024, left))):
                    left -= len(chunk)
                    yield chunk
        return chunks()

    def size(self, key: str) -> Optional[int]:
        path = self._path(key)
        return path.stat().st_size if path.is_file() else None

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

    def _files(self, prefix: str) -> Iterator[Path]:
        base = self._path(prefix)
        if base.is_dir():
            yield from (p for p in base.rglob("*") if p.is_file() and not p.name.startswith(".tmp-"))

    def list_keys(self, prefix: str) -> List[str]:
        # Without list_files' stat of each: the Observatory lists every key often.
        return sorted(p.relative_to(self.root).as_posix() for p in self._files(prefix))

    def list_files(self, prefix: str) -> List[StoredFile]:
        files = []
        for p in self._files(prefix):
            stat = p.stat()
            files.append(StoredFile(
                p.relative_to(self.root).as_posix(), stat.st_size,
                datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc),
            ))
        return sorted(files)

    def delete_prefix(self, prefix: str) -> None:
        base = self._path(prefix)
        if base.is_dir():
            shutil.rmtree(base)

    def move_prefix(self, old_prefix: str, new_prefix: str) -> None:
        old, new = self._path(old_prefix), self._path(new_prefix)
        if not old.is_dir():
            raise DocBackendError("Not found")
        if new.exists():
            # As in S3, where a folder is only the files in it: empty
            # directories left behind (by a delete) are no obstacle.
            if new.is_file() or any(p.is_file() for p in new.rglob("*")):
                raise DocBackendError("Something already exists there")
            shutil.rmtree(new)
        new.parent.mkdir(parents=True, exist_ok=True)
        old.rename(new)


class S3DocBackend(DocBackend):
    def get(self, key: str) -> Optional[str]:
        _check_key(key)
        try:
            body = storage_service._client().get_object(Bucket=settings.S3_BUCKET_NAME, Key=key)["Body"]
        except ClientError as e:
            if storage_service.is_missing(e):
                return None
            raise
        # Closed with close(), not `with`: botocore's StreamingBody gives the
        # raw urllib3 stream to a `with`, which skips its length check.
        try:
            return body.read().decode("utf-8")
        finally:
            body.close()

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
            if storage_service.is_missing(e):
                return None
            raise

        return storage_service.stream_body(obj["Body"]), obj["ContentLength"]

    def open_range(self, key: str, start: int, end: int) -> Optional[Iterator[bytes]]:
        _check_key(key)
        try:
            obj = storage_service._client().get_object(
                Bucket=settings.S3_BUCKET_NAME, Key=key, Range=f"bytes={start}-{end}",
            )
        except ClientError as e:
            if storage_service.is_missing(e):
                return None
            raise
        return storage_service.stream_body(obj["Body"])

    def size(self, key: str) -> Optional[int]:
        _check_key(key)
        try:
            head = storage_service._client().head_object(Bucket=settings.S3_BUCKET_NAME, Key=key)
        except ClientError as e:
            if storage_service.is_missing(e):
                return None
            raise
        return head["ContentLength"]

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

    def list_files(self, prefix: str) -> List[StoredFile]:
        _check_key(prefix)
        files: List[StoredFile] = []
        paginator = storage_service._client().get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=settings.S3_BUCKET_NAME, Prefix=prefix):
            files.extend(StoredFile(obj["Key"], obj["Size"], obj["LastModified"]) for obj in page.get("Contents", []))
        return sorted(files)

    def delete_prefix(self, prefix: str) -> None:
        try:
            storage_service.delete_keys(storage_service._client(), self.list_keys(prefix))
        except StorageError as e:
            raise DocBackendError(str(e))

    def move_prefix(self, old_prefix: str, new_prefix: str) -> None:
        _check_key(old_prefix)
        _check_key(new_prefix)
        try:
            storage_service._move_prefix(old_prefix, new_prefix, "Not found", "Something already exists there")
        except StorageError as e:
            raise DocBackendError(str(e))


def default_doc_backend() -> DocBackend:
    """The store STORAGE_BACKEND names: the bucket, or a local folder."""
    if settings.STORAGE_BACKEND == "s3":
        return S3DocBackend()
    return LocalDocBackend(settings.STORAGE_LOCAL_PATH)
