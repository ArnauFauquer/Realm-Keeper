from authlib.integrations.starlette_client import OAuth
from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import RedirectResponse

from config.logging import get_logger
from config.settings import settings
from services.auth_service import (
    SESSION_COOKIE_NAME,
    SESSION_MAX_AGE,
    create_session_token,
    is_email_allowed,
    verify_session_token,
)

logger = get_logger(__name__)
router = APIRouter(prefix="/api/auth", tags=["auth"])

oauth = OAuth()
oauth.register(
    name="google",
    client_id=settings.GOOGLE_CLIENT_ID,
    client_secret=settings.GOOGLE_CLIENT_SECRET,
    server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
    client_kwargs={"scope": "openid email profile"},
)


def get_session_user(request: Request) -> dict | None:
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if not token:
        return None
    return verify_session_token(token)


async def require_auth(request: Request) -> dict:
    if not settings.ENABLE_AUTH:
        return {"email": "local@realm-keeper", "name": "Local User", "local": True}
    user = get_session_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


@router.get("/login")
async def login(request: Request):
    redirect_uri = str(request.url_for("auth_callback"))
    return await oauth.google.authorize_redirect(request, redirect_uri)


@router.get("/callback", name="auth_callback")
async def callback(request: Request):
    try:
        token = await oauth.google.authorize_access_token(request)
    except Exception as e:
        logger.warning(f"Google OAuth callback failed: {e}")
        return RedirectResponse(f"{settings.FRONTEND_URL}/?auth_error=login_failed")

    userinfo = token.get("userinfo") or {}
    email = userinfo.get("email", "")
    name = userinfo.get("name", "")

    if not is_email_allowed(email):
        logger.warning(f"Rejected login attempt for {email!r} (not on allowlist)")
        return RedirectResponse(f"{settings.FRONTEND_URL}/?auth_error=not_allowed")

    logger.info(f"Login successful: {email}")
    response = RedirectResponse(settings.FRONTEND_URL)
    response.set_cookie(
        SESSION_COOKIE_NAME,
        create_session_token(email, name),
        max_age=SESSION_MAX_AGE,
        httponly=True,
        secure=settings.SESSION_COOKIE_SECURE,
        samesite="lax",
    )
    return response


@router.get("/me")
async def me(request: Request):
    if not settings.ENABLE_AUTH:
        return {"email": "local@realm-keeper", "name": "Local User", "local": True}
    user = get_session_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


@router.post("/logout")
async def logout():
    response = Response(status_code=204)
    response.delete_cookie(SESSION_COOKIE_NAME)
    return response
