"""Signing in with any OIDC provider, GitHub or Google: what each says is
turned into the verified emails matched against ALLOWED_EMAILS, and every one
comes back to the same callback. Run from backend/:
    python -m pytest tests/test_auth_providers.py
"""
import pytest
from fastapi.responses import RedirectResponse
from fastapi.testclient import TestClient

from main import app
from routes import auth
from services import auth_providers
from services.auth_providers import Identity, Provider, discovery_url, github_identity, oidc_identity
from services.auth_service import SESSION_COOKIE_NAME


@pytest.mark.parametrize("issuer,url", [
    ("https://accounts.google.com", "https://accounts.google.com/.well-known/openid-configuration"),
    ("https://auth.example.com/application/o/rk/", "https://auth.example.com/application/o/rk/.well-known/openid-configuration"),
    ("https://kc.example.com/realms/rk/.well-known/openid-configuration", "https://kc.example.com/realms/rk/.well-known/openid-configuration"),
])
def test_discovery_url(issuer, url):
    assert discovery_url(issuer) == url


def test_an_oidc_email_counts_only_once_verified():
    assert oidc_identity({"email": "a@x.com", "email_verified": True, "name": "A"}, True) == Identity(["a@x.com"], "A")
    assert oidc_identity({"email": "a@x.com", "email_verified": "true"}, True).verified_emails == ["a@x.com"]
    assert oidc_identity({"email": "a@x.com", "email_verified": False}, True).verified_emails == []
    assert oidc_identity({"email": "a@x.com"}, True).verified_emails == []
    # A provider that never says (single-tenant Entra ID), when told to trust it.
    assert oidc_identity({"email": "a@x.com", "preferred_username": "a"}, False) == Identity(["a@x.com"], "a")
    assert oidc_identity({}, False).verified_emails == []


def test_github_vouches_for_its_verified_emails_primary_first():
    identity = github_identity({"login": "gm", "name": None}, [
        {"email": "old@x.com", "verified": True, "primary": False},
        {"email": "fake@x.com", "verified": False, "primary": False},
        {"email": "main@x.com", "verified": True, "primary": True},
    ])
    assert identity == Identity(["main@x.com", "old@x.com"], "gm")


class _Client:
    async def authorize_redirect(self, request, redirect_uri):
        return RedirectResponse(f"https://provider.example/authorize?redirect_uri={redirect_uri}")


def _fake(monkeypatch, *identities):
    providers = []
    for i, emails in enumerate(identities):
        async def identify(request, emails=emails):
            return Identity(emails, "Player")
        providers.append(Provider(f"p{i}", f"Provider {i}", _Client(), identify))
    monkeypatch.setattr(auth, "PROVIDERS", providers)
    monkeypatch.setattr(auth, "provider_by_id", lambda pid: next((p for p in providers if p.id == pid), None))
    return providers


def _sign_in(client, provider=None):
    login = client.get("/api/auth/login" + (f"?provider={provider}" if provider else ""), follow_redirects=False)
    assert login.status_code in (302, 307), login.text
    return client.get("/api/auth/callback", follow_redirects=False)


def test_the_providers_are_listed_for_the_sign_in_screen(monkeypatch):
    _fake(monkeypatch, [], [])
    with TestClient(app) as client:
        assert client.get("/api/auth/providers").json() == {
            "enabled": True, "providers": [{"id": "p0", "name": "Provider 0"}, {"id": "p1", "name": "Provider 1"}],
        }


def test_any_allowed_verified_email_signs_in(monkeypatch):
    _fake(monkeypatch, ["someone@x.com"], ["other@x.com", "gm@example.com"])
    with TestClient(app, base_url="https://app.example.com") as client:
        assert "auth_error=not_allowed" in _sign_in(client, "p0").headers["location"]
        done = _sign_in(client, "p1")
        assert done.headers["location"] == "https://app.example.com"
        assert SESSION_COOKIE_NAME in done.cookies
        assert client.get("/api/auth/me").json()["email"] == "gm@example.com"


def test_a_plain_login_goes_to_the_first_provider(monkeypatch):
    _fake(monkeypatch, ["gm@example.com"])
    with TestClient(app, base_url="https://app.example.com") as client:
        assert SESSION_COOKIE_NAME in _sign_in(client).cookies


def test_an_unknown_provider_or_a_callback_out_of_nowhere_signs_no_one_in(monkeypatch):
    _fake(monkeypatch, ["gm@example.com"])
    with TestClient(app, base_url="https://app.example.com") as client:
        assert "auth_error=no_provider" in client.get("/api/auth/login?provider=nope", follow_redirects=False).headers["location"]
        stray = client.get("/api/auth/callback", follow_redirects=False)
        assert "auth_error=login_failed" in stray.headers["location"] and SESSION_COOKIE_NAME not in stray.cookies


def test_a_provider_that_cannot_be_reached_is_said_so_not_a_500(monkeypatch):
    providers = _fake(monkeypatch, ["gm@example.com"])

    class Unreachable:
        async def authorize_redirect(self, request, redirect_uri):
            raise ConnectionError("no discovery document")
    providers[0].client = Unreachable()
    with TestClient(app, base_url="https://app.example.com") as client:
        login = client.get("/api/auth/login?provider=p0", follow_redirects=False)
        assert "auth_error=provider_unreachable" in login.headers["location"]


def test_a_provider_that_fails_is_a_failed_sign_in(monkeypatch):
    providers = _fake(monkeypatch, ["gm@example.com"])

    async def broken(request):
        raise RuntimeError("provider unreachable")
    providers[0].identify = broken
    with TestClient(app, base_url="https://app.example.com") as client:
        assert "auth_error=login_failed" in _sign_in(client, "p0").headers["location"]


def test_providers_come_from_the_settings(monkeypatch):
    from config.settings import settings

    monkeypatch.setattr(settings, "OIDC_ISSUER_URL", "https://kc.example.com/realms/rk")
    monkeypatch.setattr(settings, "OIDC_CLIENT_ID", "rk")
    monkeypatch.setattr(settings, "OIDC_NAME", "Keycloak")
    monkeypatch.setattr(settings, "GITHUB_CLIENT_ID", "gh")
    monkeypatch.setattr(settings, "GOOGLE_CLIENT_ID", "")
    assert [(p.id, p.name) for p in auth_providers.configured_providers()] == [("oidc", "Keycloak"), ("github", "GitHub")]
    monkeypatch.setattr(settings, "OIDC_ISSUER_URL", "")
    monkeypatch.setattr(settings, "GITHUB_CLIENT_ID", "")
    monkeypatch.setattr(settings, "GOOGLE_CLIENT_ID", "g")
    assert [(p.id, p.name) for p in auth_providers.configured_providers()] == [("google", "Google")]
