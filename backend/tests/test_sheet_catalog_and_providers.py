"""The catalog of sheets, and the sign-in providers built from the settings.
Run from backend/:  python -m pytest tests/test_sheet_catalog_and_providers.py
"""
import asyncio
import json
from types import SimpleNamespace

import pytest

from services import auth_providers, sheet_catalog


# ── the sheet catalog ───────────────────────────────────────────────────────

def _sheet(name, **extra):
    return {"id": name.lower(), "name": name, "sheet": {"sections": []}, **extra}


@pytest.fixture
def stores(monkeypatch):
    """Two collections as the catalog reads them, with what the hub holds in memory."""
    data = {"character": {}, "adversary": {}}
    held = {}

    class Collection:
        def __init__(self, kind):
            self.kind, self.backend, self.root = kind, SimpleNamespace(list_keys=lambda root: list(data[kind])), "root-" + kind

        def ids(self, keys):
            return list(keys)

        def read_raw(self, doc_id):
            if doc_id == "../bad":
                raise ValueError("bad id")
            return data[self.kind].get(doc_id)

    monkeypatch.setattr(sheet_catalog, "COLLECTIONS", {"character": Collection("character"), "adversary": Collection("adversary")})
    monkeypatch.setattr(sheet_catalog.hub, "held", lambda kind, doc_id: held.get((kind, doc_id)))
    return SimpleNamespace(data=data, held=held)


def test_a_sheet_is_read_from_the_store_or_from_memory_when_the_hub_holds_it(stores):
    stores.data["character"]["aria"] = _sheet("Aria")
    assert sheet_catalog.get_sheet("character", "aria").sheet.name == "Aria"
    stores.held[("character", "aria")] = _sheet("Aria, edited just now")
    assert sheet_catalog.get_sheet("character", "aria").sheet.name == "Aria, edited just now"


def test_what_is_not_a_sheet_is_none(stores):
    assert sheet_catalog.get_sheet("monster", "x") is None   # not a kind
    assert sheet_catalog.get_sheet("character", "ghost") is None   # not stored
    assert sheet_catalog.get_sheet("character", "../bad") is None   # a bad id is nobody's sheet


def test_a_stored_document_that_does_not_parse_is_left_out(stores):
    stores.data["character"]["broken"] = {"id": "broken", "name": "Broken", "sheet": {"sections": "not a list"}}
    assert sheet_catalog.get_sheet("character", "broken") is None


def test_the_catalog_lists_every_valid_sheet_by_name_then_kind(stores):
    stores.data["character"]["zed"] = _sheet("Zed")
    stores.data["character"]["aria"] = _sheet("aria")
    stores.data["adversary"]["aria"] = _sheet("Aria")
    stores.data["adversary"]["broken"] = {"id": "broken", "name": "B", "sheet": {"sections": "no"}}
    entries = sheet_catalog.list_sheets()
    assert [(e.sheet.name, e.type) for e in entries] == [("Aria", "adversary"), ("aria", "character"), ("Zed", "character")]
    assert [e.ref for e in sheet_catalog.list_sheets("adversary")] == ["aria"]
    assert sheet_catalog.list_sheets("monster") == []


# ── the providers ───────────────────────────────────────────────────────────

class FakeClient:
    def __init__(self, **kwargs):
        self.kwargs = kwargs
        self.token = {"userinfo": {"email": "a@x.com", "email_verified": True, "name": "A"}}
        self.userinfo_claims = {}
        self.responses = {}
        self.userinfo_calls = 0

    async def authorize_access_token(self, request):
        return self.token

    async def userinfo(self, token):
        self.userinfo_calls += 1
        return self.userinfo_claims

    async def get(self, path, token):
        return SimpleNamespace(json=lambda: self.responses[path])


class FakeOAuth:
    def __init__(self):
        self.registered = {}

    def register(self, name, **kwargs):
        self.registered[name] = FakeClient(**kwargs)
        return self.registered[name]


def _identify(provider):
    return asyncio.run(provider.identify(None))


def test_no_settings_no_providers(monkeypatch):
    for name in ("OIDC_ISSUER_URL", "OIDC_CLIENT_ID", "GOOGLE_CLIENT_ID", "GITHUB_CLIENT_ID"):
        monkeypatch.setattr(auth_providers.settings, name, "")
    assert auth_providers.configured_providers() == []


def test_every_provider_configured_gets_a_button_in_a_fixed_order(monkeypatch):
    s = auth_providers.settings
    for name, value in dict(
        OIDC_ISSUER_URL="https://auth.example.com/", OIDC_CLIENT_ID="oidc-id", OIDC_CLIENT_SECRET="s", OIDC_NAME="Company",
        OIDC_SCOPES="openid email", OIDC_REQUIRE_VERIFIED_EMAIL=True,
        GOOGLE_CLIENT_ID="g-id", GOOGLE_CLIENT_SECRET="gs", GITHUB_CLIENT_ID="gh-id", GITHUB_CLIENT_SECRET="ghs",
    ).items():
        monkeypatch.setattr(s, name, value)
    oauth = FakeOAuth()
    monkeypatch.setattr(auth_providers, "OAuth", lambda: oauth)
    providers = auth_providers.configured_providers()
    assert [(p.id, p.name) for p in providers] == [("oidc", "Company"), ("google", "Google"), ("github", "GitHub")]
    oidc = oauth.registered["oidc"].kwargs
    assert oidc["server_metadata_url"] == "https://auth.example.com/.well-known/openid-configuration"
    assert oidc["client_kwargs"] == {"scope": "openid email"}
    assert oauth.registered["google"].kwargs["server_metadata_url"].startswith("https://accounts.google.com/")
    assert oauth.registered["github"].kwargs["client_kwargs"] == {"scope": "read:user user:email"}


def test_an_oidc_provider_reads_the_email_from_the_id_token(monkeypatch):
    monkeypatch.setattr(auth_providers.settings, "GOOGLE_CLIENT_ID", "g")
    monkeypatch.setattr(auth_providers.settings, "OIDC_ISSUER_URL", "")
    monkeypatch.setattr(auth_providers.settings, "GITHUB_CLIENT_ID", "")
    oauth = FakeOAuth()
    monkeypatch.setattr(auth_providers, "OAuth", lambda: oauth)
    [google] = auth_providers.configured_providers()
    assert _identify(google).verified_emails == ["a@x.com"]
    assert oauth.registered["google"].userinfo_calls == 0


def test_an_oidc_provider_that_leaves_the_email_out_of_the_token_is_asked_for_it(monkeypatch):
    monkeypatch.setattr(auth_providers.settings, "GOOGLE_CLIENT_ID", "")
    monkeypatch.setattr(auth_providers.settings, "OIDC_ISSUER_URL", "https://auth.example.com")
    monkeypatch.setattr(auth_providers.settings, "OIDC_CLIENT_ID", "id")
    monkeypatch.setattr(auth_providers.settings, "OIDC_REQUIRE_VERIFIED_EMAIL", False)
    monkeypatch.setattr(auth_providers.settings, "GITHUB_CLIENT_ID", "")
    oauth = FakeOAuth()
    monkeypatch.setattr(auth_providers, "OAuth", lambda: oauth)
    [oidc] = auth_providers.configured_providers()
    client = oauth.registered["oidc"]
    client.token = {"userinfo": {"name": "No Email"}}
    client.userinfo_claims = {"email": "late@x.com", "preferred_username": "late"}
    identity = _identify(oidc)
    assert identity.verified_emails == ["late@x.com"] and client.userinfo_calls == 1
    client.token = {}   # no id token claims at all
    assert _identify(oidc).verified_emails == ["late@x.com"]


def test_github_asks_its_api_for_the_profile_and_the_emails(monkeypatch):
    monkeypatch.setattr(auth_providers.settings, "GOOGLE_CLIENT_ID", "")
    monkeypatch.setattr(auth_providers.settings, "OIDC_ISSUER_URL", "")
    monkeypatch.setattr(auth_providers.settings, "GITHUB_CLIENT_ID", "gh")
    oauth = FakeOAuth()
    monkeypatch.setattr(auth_providers, "OAuth", lambda: oauth)
    [github] = auth_providers.configured_providers()
    client = oauth.registered["github"]
    client.responses = {
        "user": {"login": "gm", "name": "The GM"},
        "user/emails": [{"email": "gm@x.com", "verified": True, "primary": True}],
    }
    identity = _identify(github)
    assert identity.verified_emails == ["gm@x.com"] and identity.name == "The GM"
    # An error body from GitHub (not a list) vouches for nobody.
    client.responses["user/emails"] = {"message": "Bad credentials"}
    assert _identify(github).verified_emails == []


def test_providers_are_found_by_id(monkeypatch):
    fake = auth_providers.Provider("p1", "P", object(), None)
    monkeypatch.setattr(auth_providers, "PROVIDERS", [fake])
    assert auth_providers.provider_by_id("p1") is fake
    assert auth_providers.provider_by_id("other") is None
