"""The storage edges: a missing object is "nothing" (not an error) while any
other S3 failure is raised, a write never leaves half a file, the one S3
client is shared, and the store chosen by settings. Run from backend/:
    python -m pytest tests/test_backends_edges.py
"""
import io

import pytest
from botocore.exceptions import ClientError

from services import doc_backend, storage_service
from services.doc_backend import DocBackendError, LocalDocBackend, S3DocBackend, default_doc_backend
from services.storage_service import StorageError


def _error(code):
    return ClientError({"Error": {"Code": code, "Message": "x"}}, "Op")


# ── S3: missing is nothing, anything else is raised ─────────────────────────

class Broken:
    """An S3 client whose every call fails with `code`."""

    def __init__(self, code):
        self.code = code

    def __getattr__(self, name):
        def call(*args, **kwargs):
            raise _error(self.code)
        return call


@pytest.mark.parametrize("operation", [
    lambda b: b.get("a/b.json"),
    lambda b: b.open("a/b.png"),
    lambda b: b.open_range("a/b.mp3", 0, 9),
    lambda b: b.size("a/b.mp3"),
])
def test_a_missing_object_is_none(monkeypatch, operation):
    monkeypatch.setattr(storage_service, "_client", lambda: Broken("NoSuchKey"))
    assert operation(S3DocBackend()) is None


@pytest.mark.parametrize("operation", [
    lambda b: b.get("a/b.json"),
    lambda b: b.open("a/b.png"),
    lambda b: b.open_range("a/b.mp3", 0, 9),
    lambda b: b.size("a/b.mp3"),
])
def test_any_other_s3_failure_is_raised_for_the_route_to_make_a_502(monkeypatch, operation):
    monkeypatch.setattr(storage_service, "_client", lambda: Broken("AccessDenied"))
    with pytest.raises(ClientError):
        operation(S3DocBackend())


@pytest.mark.parametrize("operation", [
    lambda b: b.get("../escape"),
    lambda b: b.open("/abs"),
    lambda b: b.size("a/../b"),
])
def test_a_key_that_climbs_out_is_refused_before_s3_is_asked(fake_s3, operation):
    with pytest.raises(ValueError, match="Invalid key"):   # the routes answer a ValueError with a 400
        operation(S3DocBackend())


def test_s3_ranges_and_sizes_come_from_the_store(fake_s3):
    fake_s3.objects["player/a.mp3"] = bytes(range(100))
    backend = S3DocBackend()
    assert backend.size("player/a.mp3") == 100
    assert b"".join(backend.open_range("player/a.mp3", 10, 19)) == bytes(range(10, 20))


def test_deleting_a_prefix_turns_a_storage_error_into_a_backend_error(fake_s3, monkeypatch):
    def refuse(client, keys):
        raise StorageError("could not delete: a.json")

    monkeypatch.setattr(storage_service, "delete_keys", refuse)
    fake_s3.objects["docs/a.json"] = b"{}"
    with pytest.raises(DocBackendError, match="could not delete"):
        S3DocBackend().delete_prefix("docs/")


def test_moving_a_prefix_turns_a_storage_error_into_a_backend_error(fake_s3):
    with pytest.raises(DocBackendError, match="Not found"):
        S3DocBackend().move_prefix("nothing/", "somewhere/")
    fake_s3.objects["a/x.json"] = b"{}"
    fake_s3.objects["b/y.json"] = b"{}"
    with pytest.raises(DocBackendError, match="already exists"):
        S3DocBackend().move_prefix("a/", "b/")


def test_moving_an_object_onto_itself_is_a_no_op(fake_s3):
    fake_s3.objects["a/x.json"] = b"1"
    storage_service._move_object("a/x.json", "a/x.json")
    assert fake_s3.objects == {"a/x.json": b"1"}


# ── the one S3 client ───────────────────────────────────────────────────────

def test_the_s3_client_is_made_once_from_the_settings_and_shared(monkeypatch):
    made = []

    class Session:
        def client(self, service, **kwargs):
            made.append((service, kwargs))
            return object()

    monkeypatch.setattr(storage_service, "_shared_client", None)
    monkeypatch.setattr(storage_service.boto3.session, "Session", Session)
    monkeypatch.setattr(storage_service.settings, "S3_ENDPOINT_URL", "")
    monkeypatch.setattr(storage_service.settings, "S3_REGION", "eu-west-1")
    first = storage_service._client()
    assert storage_service._client() is first
    [(service, kwargs)] = made
    assert service == "s3"
    assert kwargs["endpoint_url"] is None   # "" means AWS itself, by region
    assert kwargs["region_name"] == "eu-west-1"
    monkeypatch.setattr(storage_service, "_shared_client", None)


def test_a_custom_endpoint_is_passed_through(monkeypatch):
    seen = {}

    class Session:
        def client(self, service, **kwargs):
            seen.update(kwargs)
            return object()

    monkeypatch.setattr(storage_service, "_shared_client", None)
    monkeypatch.setattr(storage_service.boto3.session, "Session", Session)
    monkeypatch.setattr(storage_service.settings, "S3_ENDPOINT_URL", "http://minio:9000")
    storage_service._client()
    assert seen["endpoint_url"] == "http://minio:9000"
    monkeypatch.setattr(storage_service, "_shared_client", None)


@pytest.mark.parametrize("code,missing", [
    ("NoSuchKey", True), ("404", True), ("NotFound", True), ("AccessDenied", False), ("500", False),
])
def test_which_s3_errors_mean_missing(code, missing):
    assert storage_service.is_missing(_error(code)) is missing
    assert storage_service.is_missing(ValueError("no response attribute")) is False


# ── a local folder never keeps half a file ──────────────────────────────────

def test_a_write_that_fails_leaves_neither_the_file_nor_a_temporary(tmp_path):
    backend = LocalDocBackend(tmp_path)
    backend.put("docs/a.json", "old")

    def explode(f):
        f.write(b"partial")
        raise OSError("disk full")

    with pytest.raises(OSError):
        backend._write("docs/a.json", explode)
    assert backend.get("docs/a.json") == "old"
    assert [p.name for p in (tmp_path / "docs").iterdir()] == ["a.json"]


def test_a_local_folder_reads_ranges_sizes_and_moves(tmp_path):
    backend = LocalDocBackend(tmp_path)
    backend.put_file("player/a.mp3", io.BytesIO(bytes(range(100))), "audio/mpeg")
    assert backend.size("player/a.mp3") == 100
    assert backend.size("player/none.mp3") is None
    assert b"".join(backend.open_range("player/a.mp3", 5, 9)) == bytes(range(5, 10))
    assert backend.open_range("player/none.mp3", 0, 1) is None
    assert backend.open("player/none.mp3") is None
    with pytest.raises(DocBackendError):
        backend.move_prefix("nothing/", "x/")


def test_a_local_move_is_not_blocked_by_empty_folders_left_by_a_delete(tmp_path):
    backend = LocalDocBackend(tmp_path)
    backend.put("a/x.json", "1")
    (tmp_path / "b" / "emptied").mkdir(parents=True)
    backend.move_prefix("a", "b")
    assert backend.get("b/x.json") == "1" and backend.get("a/x.json") is None
    backend.put("c/y.json", "2")
    with pytest.raises(DocBackendError, match="already exists"):
        backend.move_prefix("c", "b")


# ── which store ─────────────────────────────────────────────────────────────

def test_the_store_is_the_bucket_or_a_folder_as_the_settings_say(monkeypatch, tmp_path):
    monkeypatch.setattr(doc_backend.settings, "STORAGE_BACKEND", "s3")
    assert isinstance(default_doc_backend(), S3DocBackend)
    monkeypatch.setattr(doc_backend.settings, "STORAGE_BACKEND", "local")
    monkeypatch.setattr(doc_backend.settings, "STORAGE_LOCAL_PATH", tmp_path)
    store = default_doc_backend()
    assert isinstance(store, LocalDocBackend) and store.root == tmp_path
