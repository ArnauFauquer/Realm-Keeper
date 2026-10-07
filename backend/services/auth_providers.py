"""The providers people sign in with, from the settings — every one configured
gets a button on the sign-in screen:

- `oidc`: any OpenID Connect provider, found by its issuer URL (Microsoft
  Entra ID, Keycloak, Authentik, Authelia, Auth0, Okta, Zitadel, GitLab...).
- `google`: Google, by GOOGLE_CLIENT_ID alone (OIDC with Google's issuer).
- `github`: GitHub, which speaks plain OAuth 2 rather than OIDC: its emails
  come from its API, which says which ones it has verified.

All of them come back to the same callback, /api/auth/callback, so that is
the one redirect URI to register with each. What a provider says is reduced
to an Identity: the emails it vouches for, and a name to show."""
from dataclasses import dataclass, field
from typing import Awaitable, Callable, List, Optional

from authlib.integrations.starlette_client import OAuth
from starlette.requests import Request

from config.logging import get_logger
from config.settings import settings

logger = get_logger(__name__)

GOOGLE_ISSUER = "https://accounts.google.com"
DISCOVERY_PATH = "/.well-known/openid-configuration"


@dataclass
class Identity:
    verified_emails: List[str]
    name: str = ""


@dataclass
class Provider:
    id: str
    name: str
    client: object = field(repr=False)
    identify: Callable[[Request], Awaitable[Identity]] = field(repr=False)


def _verified(claim) -> bool:
    # Some providers (AWS Cognito) send it as a string.
    return claim is True or str(claim).lower() == "true"


def discovery_url(issuer: str) -> str:
    """Where an issuer publishes its OIDC configuration. The setting may be
    either the issuer (Authentik's ends in "/") or that URL itself."""
    issuer = issuer.strip()
    if issuer.endswith(DISCOVERY_PATH):
        return issuer
    return issuer.rstrip("/") + DISCOVERY_PATH


def oidc_identity(claims: dict, require_verified: bool) -> Identity:
    email = (claims.get("email") or "").strip()
    name = claims.get("name") or claims.get("preferred_username") or email
    if not email:
        return Identity([], name)
    if require_verified and not _verified(claims.get("email_verified")):
        logger.warning(f"Sign-in for {email!r} refused: the provider hasn't verified that email")
        return Identity([], name)
    return Identity([email], name)


def github_identity(profile: dict, emails: list) -> Identity:
    """GitHub's verified emails, the primary one first."""
    verified = sorted(
        (e for e in emails if isinstance(e, dict) and e.get("verified") and e.get("email")),
        key=lambda e: not e.get("primary"),
    )
    return Identity([e["email"] for e in verified], profile.get("name") or profile.get("login") or "")


def _oidc_provider(oauth: OAuth, id: str, name: str, issuer: str, client_id: str, client_secret: str,
                   scopes: str, require_verified: bool) -> Provider:
    client = oauth.register(
        name=id,
        client_id=client_id,
        client_secret=client_secret,
        server_metadata_url=discovery_url(issuer),
        client_kwargs={"scope": scopes},
    )

    async def identify(request: Request) -> Identity:
        token = await client.authorize_access_token(request)
        claims = dict(token.get("userinfo") or {})
        if not claims.get("email"):
            # Not every provider puts the email in the ID token (Entra ID
            # without the optional claim, some Authelia setups): ask for it.
            claims.update(await client.userinfo(token=token))
        return oidc_identity(claims, require_verified)

    return Provider(id, name, client, identify)


def _github_provider(oauth: OAuth) -> Provider:
    client = oauth.register(
        name="github",
        client_id=settings.GITHUB_CLIENT_ID,
        client_secret=settings.GITHUB_CLIENT_SECRET,
        authorize_url="https://github.com/login/oauth/authorize",
        access_token_url="https://github.com/login/oauth/access_token",
        api_base_url="https://api.github.com/",
        client_kwargs={"scope": "read:user user:email"},
    )

    async def identify(request: Request) -> Identity:
        token = await client.authorize_access_token(request)
        profile = (await client.get("user", token=token)).json()
        emails = (await client.get("user/emails", token=token)).json()
        return github_identity(profile, emails if isinstance(emails, list) else [])

    return Provider("github", "GitHub", client, identify)


def configured_providers() -> List[Provider]:
    oauth = OAuth()
    providers: List[Provider] = []
    if settings.OIDC_ISSUER_URL and settings.OIDC_CLIENT_ID:
        providers.append(_oidc_provider(
            oauth, "oidc", settings.OIDC_NAME, settings.OIDC_ISSUER_URL,
            settings.OIDC_CLIENT_ID, settings.OIDC_CLIENT_SECRET,
            settings.OIDC_SCOPES, settings.OIDC_REQUIRE_VERIFIED_EMAIL,
        ))
    if settings.GOOGLE_CLIENT_ID:
        providers.append(_oidc_provider(
            oauth, "google", "Google", GOOGLE_ISSUER,
            settings.GOOGLE_CLIENT_ID, settings.GOOGLE_CLIENT_SECRET,
            "openid email profile", True,
        ))
    if settings.GITHUB_CLIENT_ID:
        providers.append(_github_provider(oauth))
    return providers


PROVIDERS: List[Provider] = configured_providers()

if settings.ENABLE_AUTH and not PROVIDERS:
    logger.warning(
        "Login is on (ENABLE_AUTH) but no provider is configured: set OIDC_ISSUER_URL + OIDC_CLIENT_ID, "
        "GITHUB_CLIENT_ID or GOOGLE_CLIENT_ID, or ENABLE_AUTH=false to run without a login."
    )


def provider_by_id(provider_id: str) -> Optional[Provider]:
    return next((p for p in PROVIDERS if p.id == provider_id), None)
