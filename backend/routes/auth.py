"""Signing in: through any OpenID Connect provider, GitHub or Google (see
services/auth_providers.py), then a signed session cookie — no user database.
Whoever signs in must have a verified email on ALLOWED_EMAILS."""
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse

from config.logging import get_logger
from config.settings import settings
from services.auth_providers import PROVIDERS, provider_by_id
from services.auth_service import (
    SESSION_COOKIE_NAME,
    SESSION_MAX_AGE,
    create_session_token,
    dice_slot,
    is_email_allowed,
    verify_session_token,
)

logger = get_logger(__name__)
router = APIRouter(prefix="/api/auth", tags=["auth"])

# Which provider a sign-in under way went to, in the short-lived handshake
# session (SessionMiddleware): every provider comes back to the one callback.
PROVIDER_SESSION_KEY = "rk_auth_provider"


def get_session_user(request: Request) -> dict | None:
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if not token:
        return None
    return verify_session_token(token)


LOCAL_USER = {"email": "local@realm-keeper", "name": "Local User", "local": True}


def current_user(request: Request) -> dict | None:
    """The signed-in user, or None — for routes that also let a paired screen
    in (see routes/screen_access.py) and so can't just depend on require_auth."""
    if not settings.ENABLE_AUTH:
        return LOCAL_USER
    return get_session_user(request)


async def require_auth(request: Request) -> dict:
    user = current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


def _back_to_app(error: str | None = None) -> RedirectResponse:
    return RedirectResponse(f"{settings.FRONTEND_URL}/?auth_error={error}" if error else settings.FRONTEND_URL)


@router.get("/providers")
async def providers():
    """What the sign-in screen offers: a button per provider configured."""
    return {
        "enabled": settings.ENABLE_AUTH,
        "providers": [{"id": p.id, "name": p.name} for p in PROVIDERS] if settings.ENABLE_AUTH else [],
    }


@router.get("/login")
async def login(request: Request, provider: str | None = None):
    """Off to the provider to sign in: the one named, or the first configured
    (a plain /login, as before there was more than Google)."""
    chosen = provider_by_id(provider) if provider else (PROVIDERS[0] if PROVIDERS else None)
    if chosen is None:
        logger.warning(f"Sign-in with an unknown or unconfigured provider: {provider!r}")
        return _back_to_app("no_provider")
    request.session[PROVIDER_SESSION_KEY] = chosen.id
    redirect_uri = str(request.url_for("auth_callback"))
    try:
        return await chosen.client.authorize_redirect(request, redirect_uri)
    except Exception as e:
        # Its configuration couldn't be fetched (a wrong issuer URL, the
        # provider down): say so in the log, not as a 500 to the player.
        logger.error(f"Could not start a {chosen.name} sign-in: {e}")
        return _back_to_app("provider_unreachable")


@router.get("/callback", name="auth_callback")
async def callback(request: Request):
    chosen = provider_by_id(request.session.pop(PROVIDER_SESSION_KEY, None) or "")
    if chosen is None:
        return _back_to_app("login_failed")
    try:
        identity = await chosen.identify(request)
    except Exception as e:   # OAuthError, a provider unreachable, a bad answer
        logger.warning(f"{chosen.name} sign-in callback failed: {e}")
        return _back_to_app("login_failed")

    # An unverified address is just a claim — never match it against the
    # allowlist. A provider can vouch for several; the first allowed is used.
    email = next((e for e in identity.verified_emails if is_email_allowed(e)), None)
    if email is None:
        claimed = ", ".join(identity.verified_emails) or "no verified email"
        logger.warning(f"Rejected {chosen.name} sign-in for {claimed} (not on the allowlist)")
        return _back_to_app("not_allowed")

    logger.info(f"Login successful: {email} ({chosen.name})")
    response = _back_to_app()
    response.set_cookie(
        SESSION_COOKIE_NAME,
        create_session_token(email, identity.name),
        max_age=SESSION_MAX_AGE,
        httponly=True,
        secure=settings.SESSION_COOKIE_SECURE,
        samesite="lax",
    )
    return response


@router.get("/me")
async def me(user: dict = Depends(require_auth)):
    # None for the fixed local user (auth disabled): not on any allowlist, so
    # the frontend falls back to the default dice colours.
    return {**user, "diceSlot": dice_slot(user["email"])}


@router.post("/logout")
async def logout():
    # Asset images are cached privately for a year (config/cache.py); drop
    # them so this browser can't keep showing them once signed out.
    response = Response(status_code=204, headers={"Clear-Site-Data": '"cache"'})
    response.delete_cookie(
        SESSION_COOKIE_NAME, httponly=True, secure=settings.SESSION_COOKIE_SECURE, samesite="lax",
    )
    return response
