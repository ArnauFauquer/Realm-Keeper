"""The app reads its settings from the environment once, when it is first
imported: set them here, before any test module (or the app) is imported, so
every module sees the same vault, the same login rules and a document store
that lives in a throwaway folder."""
import os
import sys
import tempfile
from pathlib import Path

TEST_ROOT = Path(tempfile.mkdtemp())
os.environ.update({
    "VAULT_PATH": str(TEST_ROOT / "vault"),
    "LOG_DIR": str(TEST_ROOT / "logs"),
    "DOCS_LOCAL_PATH": str(TEST_ROOT / "docs"),
    "ENABLE_AUTH": "true",
    "ALLOWED_EMAILS": "gm@example.com",
    "SESSION_SECRET_KEY": "test-secret",
    "NOTE_TAG_IGNORE": "draft",
    "FRONTEND_URL": "https://app.example.com",
    "CORS_ALLOWED_ORIGINS": "https://app.example.com",
    "REPO_URL": "",
    "S3_ENDPOINT_URL": "",
})
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


# ── object storage for tests that need a document backend ───────────────────

import hashlib  # noqa: E402
import io  # noqa: E402
from datetime import datetime, timezone  # noqa: E402

import pytest  # noqa: E402
from botocore.exceptions import ClientError  # noqa: E402


def _Body(data: bytes):
    """A response body: botocore's own StreamingBody, so the code reads it as
    it reads S3's. (A look-alike hid that `with body as b` gives the raw
    urllib3 stream, not the body: 0.4.0 served no image.)"""
    from botocore.response import StreamingBody
    return StreamingBody(io.BytesIO(data), len(data))


class FakeS3:
    """Just enough of boto3's S3 client for the document backend, the player's
    storage functions, and the migration to the Observatory."""

    def __init__(self, objects=None):
        self.objects = {key: value if isinstance(value, bytes) else value.encode() for key, value in (objects or {}).items()}
        self.content_types = {}

    def _missing(self, op):
        return ClientError({"Error": {"Code": "NoSuchKey", "Message": "missing"}}, op)

    def get_object(self, Bucket, Key, Range=None):
        if Key not in self.objects:
            raise self._missing("GetObject")
        data = self.objects[Key]
        if Range:
            first, last = Range[len("bytes="):].split("-")
            data = data[int(first):int(last) + 1]
        return {"Body": _Body(data), "ContentLength": len(data)}

    def put_object(self, Bucket, Key, Body, ContentType=None, **_):
        self.objects[Key] = Body if isinstance(Body, bytes) else Body.encode()
        self.content_types[Key] = ContentType

    def upload_fileobj(self, file_obj, Bucket, Key, ExtraArgs=None):
        self.objects[Key] = file_obj.read()
        self.content_types[Key] = (ExtraArgs or {}).get("ContentType")

    def head_object(self, Bucket, Key):
        if Key not in self.objects:
            raise ClientError({"Error": {"Code": "404", "Message": "x"}}, "HeadObject")
        return {"ContentLength": len(self.objects[Key]), "ContentType": self.content_types.get(Key)}

    def list_objects_v2(self, Bucket, Prefix="", MaxKeys=1000, Delimiter=None):
        keys = sorted(k for k in self.objects if k.startswith(Prefix))
        folders, files = [], []
        for key in keys:
            rest = key[len(Prefix):]
            if Delimiter and Delimiter in rest:
                folder = Prefix + rest.split(Delimiter)[0] + Delimiter
                if folder not in folders:
                    folders.append(folder)
            else:
                files.append(key)
        result = {"Contents": [
            {
                "Key": k, "Size": len(self.objects[k]), "ETag": f'"{hashlib.md5(self.objects[k]).hexdigest()}"',
                "LastModified": datetime(2026, 1, 1, tzinfo=timezone.utc),
            }
            for k in files[:MaxKeys]
        ]}
        if Delimiter:
            result["CommonPrefixes"] = [{"Prefix": folder} for folder in folders]
        return result

    def get_paginator(self, name):
        fake = self

        class Paginator:
            def paginate(self, Bucket, Prefix="", Delimiter=None):
                yield fake.list_objects_v2(Bucket, Prefix, Delimiter=Delimiter)
        return Paginator()

    def copy_object(self, Bucket, CopySource, Key):
        self.objects[Key] = self.objects[CopySource["Key"]]
        self.content_types[Key] = self.content_types.get(CopySource["Key"])

    def copy(self, CopySource, Bucket, Key):
        self.copy_object(Bucket, CopySource, Key)

    def delete_object(self, Bucket, Key):
        self.objects.pop(Key, None)
        self.content_types.pop(Key, None)

    def delete_objects(self, Bucket, Delete):
        for obj in Delete["Objects"]:
            self.delete_object(Bucket, obj["Key"])


@pytest.fixture
def fake_s3(monkeypatch):
    """A bucket in memory, as the storage functions' S3 client."""
    from services import storage_service

    fake = FakeS3()
    monkeypatch.setattr(storage_service, "_client", lambda: fake)
    return fake


@pytest.fixture(params=["local", "s3"])
def backend(request, tmp_path, monkeypatch):
    """Each kind of document backend, in turn: a folder, and S3 (a fake one)."""
    from services import storage_service
    from services.doc_backend import LocalDocBackend, S3DocBackend

    if request.param == "local":
        return LocalDocBackend(tmp_path)
    fake = FakeS3()
    monkeypatch.setattr(storage_service, "_client", lambda: fake)
    return S3DocBackend()
