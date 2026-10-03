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

import io  # noqa: E402

import pytest  # noqa: E402
from botocore.exceptions import ClientError  # noqa: E402

class FakeS3:
    """Just enough of boto3's S3 client for S3DocBackend and _move_prefix."""

    def __init__(self):
        self.objects = {}

    def _missing(self, op):
        return ClientError({"Error": {"Code": "NoSuchKey", "Message": "missing"}}, op)

    def get_object(self, Bucket, Key):
        if Key not in self.objects:
            raise self._missing("GetObject")
        return {"Body": io.BytesIO(self.objects[Key])}

    def put_object(self, Bucket, Key, Body, **_):
        self.objects[Key] = Body

    def head_object(self, Bucket, Key):
        if Key not in self.objects:
            raise ClientError({"Error": {"Code": "404", "Message": "x"}}, "HeadObject")

    def list_objects_v2(self, Bucket, Prefix="", MaxKeys=1000):
        keys = sorted(k for k in self.objects if k.startswith(Prefix))[:MaxKeys]
        return {"Contents": [{"Key": k, "Size": len(self.objects[k])} for k in keys]}

    def get_paginator(self, name):
        fake = self

        class Paginator:
            def paginate(self, Bucket, Prefix=""):
                yield fake.list_objects_v2(Bucket, Prefix)
        return Paginator()

    def copy_object(self, Bucket, CopySource, Key):
        self.objects[Key] = self.objects[CopySource["Key"]]

    def delete_object(self, Bucket, Key):
        self.objects.pop(Key, None)

    def delete_objects(self, Bucket, Delete):
        for obj in Delete["Objects"]:
            self.objects.pop(obj["Key"], None)


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
