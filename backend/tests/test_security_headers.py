"""Headers every API response carries. Run from backend/:
    python -m pytest tests/test_security_headers.py
"""
from fastapi import FastAPI
from fastapi.testclient import TestClient

from config.security_headers import SecurityHeadersMiddleware

app = FastAPI()
app.add_middleware(SecurityHeadersMiddleware)


@app.get("/api/x")
def x():
    return {}


def test_api_responses_are_locked_down():
    r = TestClient(app).get("/api/x")
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["cross-origin-resource-policy"] == "same-origin"
    assert "default-src 'none'" in r.headers["content-security-policy"]


def test_the_api_docs_keep_no_csp():
    r = TestClient(app).get("/docs")
    assert "content-security-policy" not in r.headers
    assert r.headers["x-content-type-options"] == "nosniff"
