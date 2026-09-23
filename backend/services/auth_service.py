"""Stateless session handling: no database — the session is a signed,
self-contained cookie (email + name + expiry), verified on every request."""
from typing import Optional, TypedDict

from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from config.settings import settings

SESSION_COOKIE_NAME = "rk_session"
SESSION_MAX_AGE = 60 * 60 * 24 * 30  # 30 days


class SessionUser(TypedDict):
    email: str
    name: str


def _serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(settings.SESSION_SECRET_KEY, salt="realm-keeper-session")


def create_session_token(email: str, name: str = "") -> str:
    return _serializer().dumps({"email": email, "name": name or email})


def verify_session_token(token: str) -> Optional[SessionUser]:
    try:
        data = _serializer().loads(token, max_age=SESSION_MAX_AGE)
    except (BadSignature, SignatureExpired):
        return None
    # Re-checked on every request, not only at login: dropping someone from
    # ALLOWED_EMAILS must revoke their (up to 30-day) session immediately.
    if not is_email_allowed(data.get("email", "")):
        return None
    return {"email": data["email"], "name": data.get("name") or data["email"]}


SCREEN_COOKIE_NAME = "rk_screen"
# Same lifetime as a login session: a paired screen is re-paired about as
# often as the GM has to sign in again.
SCREEN_KEY_MAX_AGE = SESSION_MAX_AGE


def _screen_serializer() -> URLSafeTimedSerializer:
    # Separate salt: a screen key must never be accepted as a session, or
    # vice versa.
    return URLSafeTimedSerializer(settings.SESSION_SECRET_KEY, salt="realm-keeper-screen")


def create_screen_key(issued_by: str) -> str:
    return _screen_serializer().dumps({"by": issued_by})


def verify_screen_key(token: str) -> bool:
    """A screen key only lets a display device receive what the GM sends to
    it (see routes/screen_access.py), never browse anything on its own.
    Rotating SESSION_SECRET_KEY revokes every key along with every session."""
    if not token:
        return False
    try:
        data = _screen_serializer().loads(token, max_age=SCREEN_KEY_MAX_AGE)
    except (BadSignature, SignatureExpired):
        return False
    # Also dies with the GM who issued it being dropped from ALLOWED_EMAILS.
    return is_email_allowed(data.get("by", ""))


def is_email_allowed(email: str) -> bool:
    return bool(email) and email.strip().lower() in settings.ALLOWED_EMAILS
